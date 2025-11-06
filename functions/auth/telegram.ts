// /functions/auth/telegram.ts — валидация initData по новой формуле Telegram
// секрет = HMAC_SHA256(bot_token, key="WebAppData")
// hash = HMAC_SHA256(data_check_string, key=секрет)
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2,"0")).join("");

async function hmacHexWithKeyRaw(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}
async function hmacHexWithKeyString(keyStr: string, msg: string) {
  const keyRaw = te.encode(keyStr);
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}
async function sha256Raw(s: string) {
  return crypto.subtle.digest("SHA-256", te.encode(s));
}

// -------- DCS builders --------

// RAW: значения не декодируем (оставляем %xx), сортируем по ключам; в строку кладём k(декод) = v(сырое)
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
    if (k === "signature") continue; // signature не участвует в DCS для hash
    map.set(k, { rawK, rawV });
  }
  const keys = Array.from(map.keys()).sort();
  const dcs = keys.map(k => `${k}=${map.get(k)!.rawV}`).join("\n");
  return { dcs, hash };
}

// DECODED: стандартный вариант через URLSearchParams (values декодированы), исключаем hash и signature
function buildDCSDecoded(initData: string) {
  const usp = new URLSearchParams(initData);
  const hash = (usp.get("hash") || "").toLowerCase();
  usp.delete("hash");
  usp.delete("signature");
  const entries = Array.from(usp.entries()).sort(([a],[b]) => a.localeCompare(b));
  const dcs = entries.map(([k,v]) => `${k}=${v}`).join("\n");
  return { dcs, hash };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", ...extra },
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

  // Проверка срока
  const authDateStr = new URLSearchParams(initData).get("auth_date") || "0";
  const authDate = parseInt(authDateStr, 10);
  if (!Number.isFinite(authDate)) return json({ ok:false, reason:"auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now()/1000);
  if (nowSec - authDate > 48*60*60) return json({ ok:false, reason:"auth_date_expired", now:nowSec, auth_date:authDate }, 401);

  // DCS (оба варианта)
  const raw = buildDCSRaw(initData);
  const dec = buildDCSDecoded(initData);
  const clientHash = raw.hash || dec.hash || "";
  if (!clientHash) return json({ ok:false, reason:"hash_missing" }, 400);

  // --- ключи для подписи ---
  // 1) НОВЫЙ правильный секрет: HMAC(key="WebAppData", msg=token)
  //    см. core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
  //    "secret key, which is the HMAC-SHA-256 signature of the bot's token with the constant string `WebAppData` used as a key"
  const secret_webapp_hex = await hmacHexWithKeyString("WebAppData", token);
  const secret_webapp_raw = Uint8Array.from(secret_webapp_hex.match(/.{1,2}/g)!.map(h => parseInt(h, 16))).buffer;

  // 2) обратный порядок (на всякий случай): HMAC(key=token, msg="WebAppData")
  const secret_rev_hex = await hmacHexWithKeyString(token, "WebAppData");
  const secret_rev_raw = Uint8Array.from(secret_rev_hex.match(/.{1,2}/g)!.map(h => parseInt(h, 16))).buffer;

  // 3) старый «совет» из сети: SHA256(token)
  const secret_sha = await sha256Raw(token);

  // 4) fallback: сам token как ключ (почти наверняка не нужен)
  const tokenKeyRaw = te.encode(token);

  // --- считаем ожидания для обоих DCS ---
  const tryList: Array<{label:string, expect:string}> = [];

  tryList.push({ label: "raw+HMAC(WebAppData->token)", expect: await hmacHexWithKeyRaw(secret_webapp_raw, raw.dcs) });
  tryList.push({ label: "decoded+HMAC(WebAppData->token)", expect: await hmacHexWithKeyRaw(secret_webapp_raw, dec.dcs) });

  tryList.push({ label: "raw+HMAC(token->WebAppData)", expect: await hmacHexWithKeyRaw(secret_rev_raw, raw.dcs) });
  tryList.push({ label: "decoded+HMAC(token->WebAppData)", expect: await hmacHexWithKeyRaw(secret_rev_raw, dec.dcs) });

  tryList.push({ label: "raw+SHA256(token)", expect: await hmacHexWithKeyRaw(secret_sha, raw.dcs) });
  tryList.push({ label: "decoded+SHA256(token)", expect: await hmacHexWithKeyRaw(secret_sha, dec.dcs) });

  // token как ключ напрямую
  const expect_raw_tok = await hmacHexWithKeyRaw(tokenKeyRaw.buffer, raw.dcs);
  const expect_dec_tok = await hmacHexWithKeyRaw(tokenKeyRaw.buffer, dec.dcs);
  tryList.push({ label: "raw+token-key", expect: expect_raw_tok });
  tryList.push({ label: "decoded+token-key", expect: expect_dec_tok });

  // сравниваем
  const hit = tryList.find(t => t.expect === clientHash);
  if (!hit) {
    return json({
      ok: false,
      reason: "invalid_signature",
      got: clientHash,
      // для отладки — что именно пробовали
      candidates: tryList
    }, 401);
  }

  // user
  let user: any = null;
  try {
    const uj = new URLSearchParams(initData).get("user");
    user = uj ? JSON.parse(uj) : null;
  } catch {}
  if (!user?.id) return json({ ok:false, reason:"user_missing" }, 400);

  // Set-Cookie tg_uid на год
  const oneYear = 60*60*24*365;
  const cookie = [
    `tg_uid=${encodeURIComponent(String(user.id))}`,
    "Path=/","HttpOnly","Secure","SameSite=None",`Max-Age=${oneYear}`
  ].join("; ");

  return json({ ok:true, user, sig_mode: hit.label }, 200, { "Set-Cookie": cookie });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
