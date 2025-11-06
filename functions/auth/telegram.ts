// /functions/auth/telegram.ts
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2,"0")).join("");

async function sha256Raw(s: string) {
  return crypto.subtle.digest("SHA-256", te.encode(s));
}
async function hmacHex(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig);
}

// ===== helpers to build data_check_string =====

// RAW: берём initData как строку, НЕ декодируем values; сортируем по ключу
function buildDCSRaw(initData: string) {
  const parts = (initData || "").split("&").filter(Boolean);
  const map = new Map<string, string>();
  let hash = "";
  for (const p of parts) {
    const i = p.indexOf("=");
    const rawK = i >= 0 ? p.slice(0, i) : p;
    const rawV = i >= 0 ? p.slice(i + 1) : "";
    const k = decodeURIComponent(rawK);
    if (k === "hash") {
      try { hash = decodeURIComponent(rawV).toLowerCase(); } catch { hash = rawV.toLowerCase(); }
      continue;
    }
    map.set(k, rawV); // значения — сырые!
  }
  const keys = Array.from(map.keys()).sort();
  const dcs = keys.map(k => `${k}=${map.get(k) ?? ""}`).join("\n");
  return { dcs, hash, userRaw: map.get("user") ?? null };
}

// DECODED: стандартный способ — берём распарсенные k=v, значения декодированы
function buildDCSDecoded(initData: string) {
  const usp = new URLSearchParams(initData);
  const hash = (usp.get("hash") || "").toLowerCase();
  usp.delete("hash");
  const entries = Array.from(usp.entries()); // тут values уже decodeURIComponent(...)
  entries.sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const dcs = entries.map(([k,v]) => `${k}=${v}`).join("\n");
  return { dcs, hash, userJson: usp.get("user") };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok:false, reason:"server_misconfigured" }, 500);

  let initData = "";
  try {
    const b = await request.json<any>();
    if (typeof b?.initData === "string") initData = b.initData;
  } catch {}
  if (!initData) return json({ ok:false, reason:"initData_required" }, 400);

  // Строим оба варианта
  const raw = buildDCSRaw(initData);
  const dec = buildDCSDecoded(initData);

  // sanity: hash из обеих функций должен совпадать с клиентским (если initData один и тот же)
  const clientHash = raw.hash || dec.hash || "";

  // Проверяем auth_date (берём из decoded — проще)
  const authDate = parseInt(new URLSearchParams(initData).get("auth_date") || "0", 10);
  if (!Number.isFinite(authDate)) return json({ ok:false, reason:"auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now()/1000);
  if (nowSec - authDate > 48*60*60) return json({ ok:false, reason:"auth_date_expired", now:nowSec, auth_date:authDate }, 401);

  // Секрет и две подписи
  const secret = await sha256Raw(env.TELEGRAM_BOT_TOKEN);
  const expectRaw = (await hmacHex(secret, raw.dcs)).toLowerCase();
  const expectDec = (await hmacHex(secret, dec.dcs)).toLowerCase();

  // Сверяем
  let mode: "raw" | "decoded" | null = null;
  if (clientHash && clientHash === expectRaw) mode = "raw";
  else if (clientHash && clientHash === expectDec) mode = "decoded";

  if (!mode) {
    return json({
      ok:false,
      reason:"invalid_signature",
      got: clientHash,
      expected_raw: expectRaw,
      expected_decoded: expectDec
    }, 401);
  }

  // Подпись валидна — парсим user
  let user: any = null;
  try {
    const src = mode === "raw" ? decodeURIComponent(raw.userRaw || "") : (dec.userJson || "");
    user = src ? JSON.parse(src) : null;
  } catch {}
  if (!user?.id) return json({ ok:false, reason:"user_missing" }, 400);

  // Ставим куку
  const oneYear = 60*60*24*365;
  const cookie = [
    `tg_uid=${encodeURIComponent(String(user.id))}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${oneYear}`,
  ].join("; ");

  // Для отладки вернём какой режим совпал
  return json({ ok:true, user, sig_mode: mode }, 200, { "Set-Cookie": cookie });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
