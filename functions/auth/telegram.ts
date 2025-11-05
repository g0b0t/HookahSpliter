// functions/auth/telegram.ts
// Cloudflare Pages Function: POST /auth/telegram
// Требуемые env: BOT_TOKEN, SESSION_SECRET, INITDATA_TTL_SEC (опц., по умолч. 86400), SECURE_COOKIES ("1"/"0"), DEV_ALLOW_ANON ("1"/"0")

type Env = {
    BOT_TOKEN: string
    SESSION_SECRET: string
    INITDATA_TTL_SEC?: string
    SECURE_COOKIES?: string
    DEV_ALLOW_ANON?: string
  }
  
  const textJson = (obj: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(obj), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers||{}) } });
  
  const b64url = (u8: Uint8Array) =>
    btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
  
  const enc = new TextEncoder();
  
  async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, data);
    return new Uint8Array(sig);
  }
  
  async function hmacHex(keyBytes: Uint8Array, data: Uint8Array): Promise<string> {
    const bytes = await hmac(keyBytes, data);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  
  async function deriveSecretKey(botToken: string): Promise<Uint8Array> {
    // secret_key = HMAC_SHA256(message=<bot_token>, key="WebAppData")
    const key = enc.encode("WebAppData");
    const msg = enc.encode(botToken);
    return await hmac(key, msg);
  }
  
  function buildDataCheckString(initData: string) {
    const sp = new URLSearchParams(initData);
    const all: [string,string][] = [];
    sp.forEach((v, k) => all.push([k, v]));
    const withoutHash = all.filter(([k]) => k !== "hash").sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const dcs = withoutHash.map(([k,v]) => `${k}=${v}`).join("\n");
    const params = Object.fromEntries(all);
    return { dcs, params };
  }
  
  async function verifyInitData(initData: string, botToken: string, ttlSec: number) {
    const { dcs, params } = buildDataCheckString(initData);
    const provided = (params["hash"] || "").toLowerCase();
    if (!provided) throw new Response("no_hash", { status: 400 });
  
    const secretKey = await deriveSecretKey(botToken);
    const expected = await hmacHex(secretKey, enc.encode(dcs));
    if (expected !== provided) {
      throw new Response("bad_hash", { status: 401 });
    }
  
    const authDate = parseInt(params["auth_date"] || "0", 10) || 0;
    const now = Math.floor(Date.now()/1000);
    if (!authDate || (now - authDate) > ttlSec) {
      throw new Response("expired", { status: 401 });
    }
  
    let user: any = null;
    try { user = params["user"] ? JSON.parse(params["user"]) : null; } catch {}
    return { user, params };
  }
  
  async function makeJwtHS256(payload: Record<string, unknown>, secret: string): Promise<string> {
    const header = { alg: "HS256", typ: "JWT" };
    const p1 = b64url(enc.encode(JSON.stringify(header)));
    const p2 = b64url(enc.encode(JSON.stringify(payload)));
    const data = enc.encode(`${p1}.${p2}`);
    const sig = await hmac(enc.encode(secret), data);
    const p3 = b64url(sig);
    return `${p1}.${p2}.${p3}`;
  }
  
  export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    const { BOT_TOKEN, SESSION_SECRET } = env;
    const ttl = parseInt(env.INITDATA_TTL_SEC || "86400", 10);
    const secure = env.SECURE_COOKIES === "1";
  
    const body = await request.json().catch(() => ({} as any));
    const initData: string | undefined = body?.initData;
  
    // Опциональный гостевой режим для дев-среды
    if ((!initData || !initData.length) && env.DEV_ALLOW_ANON === "1") {
      const guest = { id: 1, first_name: "Гость", last_name: "Dev" };
      const now = Math.floor(Date.now()/1000);
      const token = await makeJwtHS256({
        sub: String(guest.id),
        name: `${guest.first_name} ${guest.last_name}`.trim(),
        iat: now,
        exp: now + 60*60*24*30,
        tg: { id: guest.id, username: null },
      }, SESSION_SECRET);
  
      const cookie = [
        `sid=${token}`,
        "HttpOnly",
        `SameSite=${secure ? "None" : "Lax"}`,
        secure ? "Secure" : "",
        "Path=/",
        `Max-Age=${60*60*24*30}`
      ].filter(Boolean).join("; ");
  
      return textJson({ ok: true, user: guest }, { headers: { "Set-Cookie": cookie } });
    }
  
    if (!initData) return textJson({ error: "no_init_data" }, { status: 400 });
    if (!BOT_TOKEN) return textJson({ error: "bot_token_not_configured" }, { status: 500 });
  
    try {
      const { user } = await verifyInitData(initData, BOT_TOKEN, ttl);
  
      const now = Math.floor(Date.now()/1000);
      const token = await makeJwtHS256({
        sub: String(user?.id ?? "guest"),
        name: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() || "Гость",
        iat: now,
        exp: now + 60*60*24*30,
        tg: { id: user?.id ?? null, username: user?.username ?? null },
      }, SESSION_SECRET);
  
      const cookie = [
        `sid=${token}`,
        "HttpOnly",
        `SameSite=${secure ? "None" : "Lax"}`,
        secure ? "Secure" : "",
        "Path=/",
        `Max-Age=${60*60*24*30}`
      ].filter(Boolean).join("; ");
  
      return textJson({ ok: true, user }, { headers: { "Set-Cookie": cookie } });
    } catch (e: any) {
      if (e instanceof Response) return e;
      return textJson({ error: "auth_failed" }, { status: 401 });
    }
  };
  