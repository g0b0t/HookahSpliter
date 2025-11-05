// /functions/auth/telegram.ts  (Cloudflare Pages Functions)
type Env = {
    TELEGRAM_BOT_TOKEN: string;
  };
  
  const te = new TextEncoder();
  
  function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
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
  
  /**
   * Строим data_check_string ИЗ СЫРОГО query-string initData:
   * - не декодируем value (сохраняем проценты как есть!)
   * - выбрасываем hash
   * - сортируем по ключам (ключи можно decodeURIComponent для сортировки)
   */
  function buildDataCheckStringRaw(initData: string): { dataCheckString: string; hashFromClient: string; rawMap: Map<string, string> } {
    const parts = (initData || "").split("&");
    const rawMap = new Map<string, string>();
    let hashFromClient = "";
  
    for (const p of parts) {
      if (!p) continue;
      const eq = p.indexOf("=");
      const rawKey = eq >= 0 ? p.slice(0, eq) : p;
      const rawVal = eq >= 0 ? p.slice(eq + 1) : "";
      const keyDec = decodeURIComponent(rawKey);
  
      if (keyDec === "hash") {
        // hash передаётся как hex, на всякий случай декодируем (обычно и так без %)
        try { hashFromClient = decodeURIComponent(rawVal).toLowerCase(); }
        catch { hashFromClient = rawVal.toLowerCase(); }
        continue;
      }
      // Храним НЕдекодированный value (как в оригинальном initData)
      rawMap.set(keyDec, rawVal);
    }
  
    const keys = Array.from(rawMap.keys()).sort();
    const lines = keys.map(k => `${k}=${rawMap.get(k) ?? ""}`);
    return { dataCheckString: lines.join("\n"), hashFromClient, rawMap };
  }
  
  export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return json({ ok: false, reason: "server_misconfigured" }, 500);
    }
  
    // Ждём { initData: string }
    let initData = "";
    try {
      const body = await request.json<any>();
      if (typeof body?.initData === "string") initData = body.initData;
    } catch { /* ignore */ }
  
    if (!initData) return json({ ok: false, reason: "initData_required" }, 400);
  
    const { dataCheckString, hashFromClient, rawMap } = buildDataCheckStringRaw(initData);
    if (!hashFromClient) return json({ ok: false, reason: "hash_missing" }, 400);
  
    // Проверка окна валидности по auth_date (секунды unix)
    const authDateRaw = rawMap.get("auth_date") ?? "";
    const authDateStr = decodeURIComponent(authDateRaw);
    const authDate = parseInt(authDateStr, 10);
    if (!Number.isFinite(authDate)) return json({ ok: false, reason: "auth_date_invalid" }, 400);
  
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - authDate > 48 * 60 * 60) {
      return json({ ok: false, reason: "auth_date_expired", server_now: nowSec, auth_date: authDate }, 401);
    }
  
    // Секрет = SHA256(bot_token), затем HMAC(secret, data_check_string)
    const secretKeyRaw = await sha256Raw(env.TELEGRAM_BOT_TOKEN);
    const ourHash = (await hmacSHA256Hex(secretKeyRaw, dataCheckString)).toLowerCase();
  
    if (ourHash !== hashFromClient) {
      return json({ ok: false, reason: "invalid_signature", expected: ourHash, got: hashFromClient }, 401);
    }
  
    // Подпись валидна — парсим user (тут уже можно декодировать value и JSON.parse)
    let user: any = null;
    const userRaw = rawMap.get("user");
    if (userRaw) {
      try { user = JSON.parse(decodeURIComponent(userRaw)); } catch { /* ignore */ }
    }
    if (!user?.id) return json({ ok: false, reason: "user_missing" }, 400);
  
    // Кука с tg_uid на год. Без Domain= для *.pages.dev
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