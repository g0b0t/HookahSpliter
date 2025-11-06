// /functions/auth/telegram.ts
// Валидация initData по схеме: decoded + sorted + withSig + HMAC(WebAppData -> bot_token)
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) =>
  Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2, "0")).join("");

// HMAC(keyRaw, msg) -> hex (lowercase)
async function hmacHexWithRawKey(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}

// СЕКРЕТ (RAW BYTES): HMAC_SHA256(key="WebAppData", msg=bot_token)
async function buildWebAppSecretRaw(botToken: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", te.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, te.encode(botToken)) as Promise<ArrayBuffer>;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ ok: false, reason: "server_misconfigured" }, 500);

  // ждём { initData: string }
  let initData = "";
  try {
    const b = await request.json<any>();
    if (typeof b?.initData === "string") initData = b.initData;
  } catch {}
  if (!initData) return json({ ok: false, reason: "initData_required" }, 400);

  // 1) TTL-проверка (48ч)
  const uspAll = new URLSearchParams(initData);
  const authDate = parseInt(uspAll.get("auth_date") || "0", 10);
  if (!Number.isFinite(authDate)) return json({ ok: false, reason: "auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > 48 * 60 * 60)
    return json({ ok: false, reason: "auth_date_expired", now: nowSec, auth_date: authDate }, 401);

  // 2) DCS: decoded + sorted + withSig (исключаем только "hash", signature оставляем)
  const clientHash = (uspAll.get("hash") || "").toLowerCase();
  if (!clientHash) return json({ ok: false, reason: "hash_missing" }, 400);

  const uspForDcs = new URLSearchParams(initData);
  uspForDcs.delete("hash");            // hash не участвует
  // signature НЕ удаляем
  const pairs = Array.from(uspForDcs.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dcs = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  // 3) SECRET (RAW) и ожидаемый hash
  const secretRaw = await buildWebAppSecretRaw(token);
  const expected = await hmacHexWithRawKey(secretRaw, dcs);

  if (expected !== clientHash) {
    return json({ ok: false, reason: "invalid_signature" }, 401);
  }

  // 4) user -> кука tg_uid
  let user: any = null;
  try { user = JSON.parse(uspAll.get("user") || "null"); } catch {}
  if (!user?.id) return json({ ok: false, reason: "user_missing" }, 400);

  const oneYear = 60 * 60 * 24 * 365;
  const cookie = [
    `tg_uid=${encodeURIComponent(String(user.id))}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${oneYear}`,
  ].join("; ");

  return json({ ok: true, user }, 200, { "Set-Cookie": cookie });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
