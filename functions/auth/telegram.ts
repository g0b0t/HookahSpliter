// functions/auth/telegram.ts
// POST /auth/telegram — верификация Telegram initData и выдача JWT в __Host-sid (HttpOnly)

type Env = {
    BOT_TOKEN: string
    SESSION_SECRET: string
    INITDATA_TTL_SEC?: string
    DEV_ALLOW_ANON?: string
    DEBUG_HEADERS?: string
  }
  
  const enc = new TextEncoder();
  
  const asJson = (data: unknown, status = 200, extra: HeadersInit = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...extra },
    });
  
  const b64url = (u8: Uint8Array) =>
    btoa(String.fromCharCode(...u8))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
  
  async function hmacRaw(keyBytes: Uint8Array, data: Uint8Array) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, data);
    return new Uint8Array(sig);
  }
  async function hmacHex(keyBytes: Uint8Array, data: Uint8Array) {
    const bytes = await hmacRaw(keyBytes, data);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function deriveSecretKey(botToken: string) {
    // secret_key = HMAC_SHA256(message=<bot_token>, key="WebAppData")
    return hmacRaw(enc.encode("WebAppData"), enc.encode(botToken));
  }
  
  function buildDataCheckString(initData: string) {
    const sp = new URLSearchParams(initData);
    const all: [string, string][] = [];
    sp.forEach((v, k) => all.push([k, v]));
    const withoutHash = all.filter(([k]) => k !== "hash")
                           .sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const dcs = withoutHash.map(([k,v]) => `${k}=${v}`).join("\n");
    const params = Object.fromEntries(all);
    return { dcs, params };
  }
  
  function timingSafeEqual(a: string, b: string) {
    if (a.length !== b.length) return false;
    let out = 0;
    for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
  }
  
  async function makeJwtHS256(payload: Record<string, unknown>, secret: string) {
    const header = { alg: "HS256", typ: "JWT" };
    const p1 = b64url(enc.encode(JSON.stringify(header)));
    const p2 = b64url(enc.encode(JSON.stringify(payload)));
    const sig = await hmacRaw(enc.encode(secret), enc.encode(`${p1}.${p2}`));
    const p3 = b64url(sig);
    return `${p1}.${p2}.${p3}`;
  }
  
  async function verifyInitData(initData: string, botToken: string, ttlSec: number) {
    const { dcs, params } = buildDataCheckString(initData);
    const provided = String(params["hash"] || "").toLowerCase();
    if (!provided) throw new Response("bad_request", { status: 400 });
  
    const secretKey = await deriveSecretKey(botToken);
    const expected = await hmacHex(secretKey, enc.encode(dcs));
    if (!timingSafeEqual(expected, provided)) throw new Response("unauthorized", { status: 401 });
  
    const authDate = parseInt(String(params["auth_date"] || "0"), 10) || 0;
    const now = Math.floor(Date.now()/1000);
    if (!authDate || (now - authDate) > ttlSec) throw new Response("expired", { status: 401 });
  
    let user: any = null;
    try { user = params["user"] ? JSON.parse(String(params["user"])) : null; } catch {}
    return { user, params };
  }
  
  export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    try {
      const { BOT_TOKEN, SESSION_SECRET } = env;
      const ttl = parseInt(env.INITDATA_TTL_SEC || "86400", 10);
  
      // Грубый лимит на тело запроса (10 КБ)
      const cl = Number(request.headers.get("content-length") || 0);
      if (cl > 10_000) return asJson({ error: "payload_too_large" }, 413);
  
      const url = new URL(request.url);
      const origin = `${url.protocol}//${url.host}`;
  
      const body = await request.json().catch(() => ({} as any));
      const initData: string | undefined = body?.initData;
  
      // Dev/preview режим без Telegram (по флагу)
      if ((!initData || !initData.length) && env.DEV_ALLOW_ANON === "1") {
        const guest = { id: 1, first_name: "Гость", last_name: "Dev" };
        const now = Math.floor(Date.now()/1000);
        const token = await makeJwtHS256({
          aud: "twa",
          iss: origin,
          sub: String(guest.id),
          name: `${guest.first_name} ${guest.last_name}`.trim(),
          iat: now,
          exp: now + 60*60*24*30,
          tg: { id: guest.id, username: null },
        }, SESSION_SECRET);
  
        const cookie = [
          `__Host-sid=${token}`,
          "HttpOnly",
          "Secure",
          "SameSite=None",
          "Path=/",
          `Max-Age=${60*60*24*30}`
        ].join("; ");
  
        const extra: HeadersInit = { "Set-Cookie": cookie };
        if (env.DEBUG_HEADERS === "1") (extra as any)["X-Debug-Set-Cookie"] = cookie;
  
        return asJson({ ok: true, user: guest }, 200, extra);
      }
  
      if (!initData) return asJson({ error: "bad_request" }, 400);
      if (!BOT_TOKEN || !SESSION_SECRET) return asJson({ error: "server_misconfigured" }, 500);
  
      const { user } = await verifyInitData(initData, BOT_TOKEN, ttl);
  
      const now = Math.floor(Date.now()/1000);
      const token = await makeJwtHS256({
        aud: "twa",
        iss: origin,
        sub: String(user?.id ?? "guest"),
        name: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() || "Гость",
        iat: now,
        exp: now + 60*60*24*30,
        tg: { id: user?.id ?? null, username: user?.username ?? null },
      }, SESSION_SECRET);
  
      const cookie = [
        `__Host-sid=${token}`,
        "HttpOnly",
        "Secure",
        "SameSite=None",
        "Path=/",
        `Max-Age=${60*60*24*30}`
      ].join("; ");
  
      const extra: HeadersInit = { "Set-Cookie": cookie };
      if (env.DEBUG_HEADERS === "1") (extra as any)["X-Debug-Set-Cookie"] = cookie;
  
      return asJson({ ok: true, user }, 200, extra);
    } catch (e) {
      // Снаружи — маскируем детали
      console.error("auth_error", e);
      if (e instanceof Response) return e; // уже нормирован
      return asJson({ error: "auth_failed" }, 401);
    }
  };
  