// /functions/auth/telegram.ts
type Env = {
    TELEGRAM_BOT_TOKEN: string;
  };
  
  const te = new TextEncoder();
  
  function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders,
      },
    });
  }
  
  function bufToHex(buf: ArrayBuffer): string {
    const v = new Uint8Array(buf);
    return Array.from(v).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  
  async function hmacSHA256Hex(keyRaw: ArrayBuffer, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
    return bufToHex(sig);
  }
  
  async function sha256Raw(input: string): Promise<ArrayBuffer> {
    return crypto.subtle.digest("SHA-256", te.encode(input));
  }
  
  function buildDataCheckString(params: URLSearchParams): string {
    // Берём все ключи кроме "hash", сортируем по алфавиту и склеиваем "k=value" через \n
    const pairs: string[] = [];
    const keys = Array.from(params.keys()).filter(k => k !== "hash").sort();
    for (const k of keys) {
      // Важно: URLSearchParams уже декодировал значение — именно так рекомендует Telegram
      const v = params.get(k) ?? "";
      pairs.push(`${k}=${v}`);
    }
    return pairs.join("\n");
  }
  
  function parseUserFromInitData(params: URLSearchParams): any | null {
    const raw = params.get("user");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  
  export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return json({ ok: false, reason: "server_misconfigured" }, 500);
    }
  
    // Ожидаем тело: { initData: string }
    let initData: string | undefined;
    try {
      const body = await request.json<any>();
      initData = body?.initData;
    } catch {
      /* пусто */
    }
    if (!initData || typeof initData !== "string") {
      return json({ ok: false, reason: "initData_required" }, 400);
    }
  
    // Разбираем initData как querystring
    const params = new URLSearchParams(initData);
    const hashFromClient = (params.get("hash") || "").toLowerCase();
    if (!hashFromClient) {
      return json({ ok: false, reason: "hash_missing" }, 400);
    }
  
    // Проверка срока действия (auth_date из initData — секунды)
    const authDateStr = params.get("auth_date");
    if (!authDateStr) {
      return json({ ok: false, reason: "auth_date_missing" }, 400);
    }
    const authDate = parseInt(authDateStr, 10);
    if (!Number.isFinite(authDate)) {
      return json({ ok: false, reason: "auth_date_invalid" }, 400);
    }
    // Разрешим до 48 часов с момента авторизации
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - authDate > 48 * 60 * 60) {
      return json({ ok: false, reason: "auth_date_expired" }, 401);
    }
  
    // Формируем data_check_string
    const dataCheckString = buildDataCheckString(params);
  
    // Секрет = SHA256(bot_token)
    const secretKeyRaw = await sha256Raw(env.TELEGRAM_BOT_TOKEN);
  
    // Наш HMAC
    const ourHash = (await hmacSHA256Hex(secretKeyRaw, dataCheckString)).toLowerCase();
  
    if (ourHash !== hashFromClient) {
      return json({ ok: false, reason: "invalid_signature" }, 401);
    }
  
    const user = parseUserFromInitData(params);
    const uid = user?.id ? String(user.id) : null;
    if (!uid) {
      return json({ ok: false, reason: "user_missing" }, 400);
    }
  
    // Ставим куку tg_uid (один год). Без Domain=, чтобы надёжно прилипла на *.pages.dev
    const oneYear = 60 * 60 * 24 * 365;
    const setCookie = [
      `tg_uid=${encodeURIComponent(uid)}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=None",
      `Max-Age=${oneYear}`,
    ].join("; ");
  
    return json(
      { ok: true, user },
      200,
      { "Set-Cookie": setCookie }
    );
  };
  
  // (опционально) можно вернуть 405 для других методов
  export const onRequestGet: PagesFunction = async () =>
    new Response("Method Not Allowed", { status: 405 });  