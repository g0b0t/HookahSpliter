// /functions/auth/telegram.ts — финальная версия с поддержкой 4 вариантов подписи
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) =>
  Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2, "0")).join("");

async function sha256Raw(s: string) {
  return crypto.subtle.digest("SHA-256", te.encode(s));
}

async function hmacHexWithKeyRaw(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}

async function hmacHexWithToken(token: string, msg: string) {
  const keyRaw = te.encode(token);
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}

// ----- data_check_string builders -----

// RAW: значения НЕ декодируем (оставляем %xx), сортируем по исходным ключам;
// в DCS ключ — ДЕКОДИРОВАН, значение — СЫРОЕ
function buildDCSRaw(initData: string) {
  const parts = (initData || "").split("&").filter(Boolean);
  const map = new Map<string, string>(); // key: rawKey, val: rawValue
  let hash = "";
  let userRaw: string | null = null;

  for (const p of parts) {
    const i = p.indexOf("=");
    const rawK = i >= 0 ? p.slice(0, i) : p;
    const rawV = i >= 0 ? p.slice(i + 1) : "";
    const keyDec = decodeURIComponent(rawK);

    if (keyDec === "hash") {
      try { hash = decodeURIComponent(rawV).toLowerCase(); } catch { hash = rawV.toLowerCase(); }
      continue;
    }
    if (keyDec === "user") userRaw = rawV;
    map.set(rawK, rawV);
  }

  const keys = Array.from(map.keys()).sort();
  const dcs = keys.map(k => `${decodeURIComponent(k)}=${map.get(k) ?? ""}`).join("\n");
  return { dcs, hash, userRaw };
}

// DECODED: URLSearchParams (значения уже декодированы), сортируем по ключам
function buildDCSDecoded(initData: string) {
  const usp = new URLSearchParams(initData);
  const hash = (usp.get("hash") || "").toLowerCase();
  usp.delete("hash");
  const entries = Array.from(usp.entries()).sort(([a],[b]) => a.localeCompare(b));
  const dcs = entries.map(([k,v]) => `${k}=${v}`).join("\n");
  const userJson = usp.get("user");
  return { dcs, hash, userJson };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
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

  const raw = buildDCSRaw(initData);
  const dec = buildDCSDecoded(initData);
  const clientHash = raw.hash || dec.hash || "";
  if (!clientHash) return json({ ok:false, reason:"hash_missing" }, 400);

  // Проверка срока
  const authDate = parseInt(new URLSearchParams(initData).get("auth_date") || "0", 10);
  if (!Number.isFinite(authDate)) return json({ ok:false, reason:"auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now()/1000);
  if (nowSec - authDate > 48*60*60) return json({ ok:false, reason:"auth_date_expired", now:nowSec, auth_date:authDate }, 401);

  // Все 4 варианта
  const secretSha = await sha256Raw(token);
  const expect_raw_sha     = await hmacHexWithKeyRaw(secretSha, raw.dcs);
  const expect_decoded_sha = await hmacHexWithKeyRaw(secretSha, dec.dcs);
  const expect_raw_token   = await hmacHexWithToken(token, raw.dcs);
  const expect_decoded_tok = await hmacHexWithToken(token, dec.dcs);

  let mode: string | null = null;
  if (clientHash === expect_raw_sha)        mode = "raw+sha256(token)";
  else if (clientHash === expect_decoded_sha) mode = "decoded+sha256(token)";
  else if (clientHash === expect_raw_token)   mode = "raw+token";
  else if (clientHash === expect_decoded_tok) mode = "decoded+token";

  if (!mode) {
    return json({
      ok:false,
      reason:"invalid_signature",
      got: clientHash,
      expected_raw_sha: expect_raw_sha,
      expected_decoded_sha: expect_decoded_sha,
      expected_raw_token: expect_raw_token,
      expected_decoded_token: expect_decoded_tok
    }, 401);
  }

  // user
  let user: any = null;
  try {
    const src = raw.userRaw ? decodeURIComponent(raw.userRaw) : dec.userJson || "";
    user = src ? JSON.parse(src) : null;
  } catch {}
  if (!user?.id) return json({ ok:false, reason:"user_missing" }, 400);

  const oneYear = 60 * 60 * 24 * 365;
  const cookie = [
    `tg_uid=${encodeURIComponent(String(user.id))}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${oneYear}`,
  ].join("; ");

  return json({ ok:true, user, sig_mode: mode }, 200, { "Set-Cookie": cookie });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });