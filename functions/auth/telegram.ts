// /functions/auth/telegram.ts — супер-диагностика
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2,"0")).join("");
const short = (s: string, n = 80) => (s.length > n ? s.slice(0, n) + "…(" + s.length + ")" : s + " (" + s.length + ")");

async function sha256Raw(s: string) { return crypto.subtle.digest("SHA-256", te.encode(s)); }
async function hmacHex(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}
async function hmacHexByToken(token: string, msg: string) {
  const raw = te.encode(token);
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}

// ===== DCS builders =====

// RAW: значения НЕ декодируем (оставляем %xx), сортируем по ключам (имена ключей ASCII)
function buildDCSRaw(initData: string) {
  const parts = (initData || "").split("&").filter(Boolean);
  const map = new Map<string, { rawK: string; rawV: string }>();
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
    map.set(k, { rawK, rawV });
  }
  const keys = Array.from(map.keys()).sort();
  const lines = keys.map(k => `${k}=${map.get(k)!.rawV}`);
  return { dcs: lines.join("\n"), hash, keys, valsPreview: keys.map(k => [k, short(map.get(k)!.rawV)]) };
}

// DECODED: значения уже декодированы, сортировка по ключам
function buildDCSDecoded(initData: string) {
  const usp = new URLSearchParams(initData);
  const hash = (usp.get("hash") || "").toLowerCase();
  usp.delete("hash");
  const entries = Array.from(usp.entries()).sort(([a],[b]) => a.localeCompare(b));
  const lines = entries.map(([k, v]) => `${k}=${v}`);
  const keys = entries.map(([k]) => k);
  const valsPreview = entries.map(([k,v]) => [k, short(v)]);
  return { dcs: lines.join("\n"), hash, keys, valsPreview };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", ...extra } });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ ok:false, reason:"server_misconfigured" }, 500);

  let initData = "";
  try {
    const b = await request.json<any>();
    if (typeof b?.initData === "string") initData = b.initData;
  } catch {}
  if (!initData) return json({ ok:false, reason:"initData_required" }, 400);

  // Срок действия
  const authDate = parseInt(new URLSearchParams(initData).get("auth_date") || "0", 10);
  if (!Number.isFinite(authDate)) return json({ ok:false, reason:"auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now()/1000);
  if (nowSec - authDate > 48*60*60) return json({ ok:false, reason:"auth_date_expired", now:nowSec, auth_date:authDate }, 401);

  // DCS оба варианта
  const raw = buildDCSRaw(initData);
  const dec = buildDCSDecoded(initData);

  const clientHash = raw.hash || dec.hash || "";
  if (!clientHash) return json({ ok:false, reason:"hash_missing" }, 400);

  // 4 подписи
  const secretSha = await sha256Raw(token);
  const expect_raw_sha     = await hmacHex(secretSha, raw.dcs);
  const expect_decoded_sha = await hmacHex(secretSha, dec.dcs);
  const expect_raw_token   = await hmacHexByToken(token, raw.dcs);
  const expect_decoded_tok = await hmacHexByToken(token, dec.dcs);

  let mode: string | null = null;
  if (clientHash === expect_raw_sha)        mode = "raw+sha256(token)";
  else if (clientHash === expect_decoded_sha) mode = "decoded+sha256(token)";
  else if (clientHash === expect_raw_token)   mode = "raw+token";
  else if (clientHash === expect_decoded_tok) mode = "decoded+token";

  // Если ничего не сошлось — вернём расширенную диагностику
  if (!mode) {
    return json({
      ok: false,
      reason: "invalid_signature",
      got: clientHash,
      // Покажем, что именно подписывали
      dcs_raw_preview: short(raw.dcs, 300),
      dcs_decoded_preview: short(dec.dcs, 300),
      keys_raw: raw.keys,
      keys_decoded: dec.keys,
      values_raw_preview: raw.valsPreview,
      values_decoded_preview: dec.valsPreview,
      expected_raw_sha: expect_raw_sha,
      expected_decoded_sha: expect_decoded_sha,
      expected_raw_token: expect_raw_token,
      expected_decoded_token: expect_decoded_tok
    }, 401);
  }

  // Парсим user
  let user: any = null;
  try {
    const usp = new URLSearchParams(initData);
    const uj = usp.get("user");
    user = uj ? JSON.parse(uj) : null;
  } catch {}
  if (!user?.id) return json({ ok:false, reason:"user_missing" }, 400);

  // Ставим куку
  const oneYear = 60*60*24*365;
  const cookie = [
    `tg_uid=${encodeURIComponent(String(user.id))}`,
    "Path=/", "HttpOnly", "Secure", "SameSite=None", `Max-Age=${oneYear}`
  ].join("; ");

  return json({ ok:true, user, sig_mode: mode }, 200, { "Set-Cookie": cookie });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
