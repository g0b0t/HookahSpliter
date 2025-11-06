// /functions/auth/telegram.ts — финал с правильными RAW-ключами HMAC
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) =>
  Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2, "0")).join("");

async function hmacHexWithRawKey(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}

async function hmacRawByKeyString(keyStr: string, msgStr: string): Promise<ArrayBuffer> {
  // Возвращаем СЫРЫЕ БАЙТЫ результата HMAC(keyStr, msgStr)
  const key = await crypto.subtle.importKey("raw", te.encode(keyStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, te.encode(msgStr)) as Promise<ArrayBuffer>;
}

async function sha256Raw(s: string) {
  return crypto.subtle.digest("SHA-256", te.encode(s));
}

// ---------- DCS builders (8 вариантов) ----------
type DcsVariant = { label: string; dcs: string; hash: string };

function buildDcsVariants(initData: string): DcsVariant[] {
  // разберём как пришло
  const pairs: Array<{ rawK: string; rawV: string; k: string; vDec: string }> = [];
  let clientHash = "";

  for (const part of (initData || "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const rawK = i >= 0 ? part.slice(0, i) : part;
    const rawV = i >= 0 ? part.slice(i + 1) : "";
    const k = decodeURIComponent(rawK);
    let vDec = "";
    try { vDec = decodeURIComponent(rawV); } catch { vDec = rawV; }

    if (k === "hash") {
      clientHash = vDec.toLowerCase();
    } else {
      pairs.push({ rawK, rawV, k, vDec });
    }
  }

  const makeDcs = (arr: typeof pairs, includeSig: boolean, useRawVals: boolean) => {
    const use = includeSig ? arr : arr.filter(p => p.k !== "signature");
    return use.map(p => `${p.k}=${useRawVals ? p.rawV : p.vDec}`).join("\n");
  };

  const sorted = [...pairs].sort((a, b) => a.k.localeCompare(b.k));

  const out: DcsVariant[] = [];
  // raw unsorted
  out.push({ label: "raw+unsorted+withSig", dcs: makeDcs(pairs, true, true), hash: clientHash });
  out.push({ label: "raw+unsorted+noSig",   dcs: makeDcs(pairs, false, true), hash: clientHash });
  // raw sorted
  out.push({ label: "raw+sorted+withSig",   dcs: makeDcs(sorted, true, true), hash: clientHash });
  out.push({ label: "raw+sorted+noSig",     dcs: makeDcs(sorted, false, true), hash: clientHash });
  // decoded unsorted
  out.push({ label: "decoded+unsorted+withSig", dcs: makeDcs(pairs, true, false), hash: clientHash });
  out.push({ label: "decoded+unsorted+noSig",   dcs: makeDcs(pairs, false, false), hash: clientHash });
  // decoded sorted
  out.push({ label: "decoded+sorted+withSig",   dcs: makeDcs(sorted, true, false), hash: clientHash });
  out.push({ label: "decoded+sorted+noSig",     dcs: makeDcs(sorted, false, false), hash: clientHash });

  return out;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ ok: false, reason: "server_misconfigured" }, 500);

  let initData = "";
  try {
    const b = await request.json<any>();
    if (typeof b?.initData === "string") initData = b.initData;
  } catch {}
  if (!initData) return json({ ok: false, reason: "initData_required" }, 400);

  // TTL
  const authDate = parseInt(new URLSearchParams(initData).get("auth_date") || "0", 10);
  if (!Number.isFinite(authDate)) return json({ ok: false, reason: "auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > 48 * 60 * 60)
    return json({ ok: false, reason: "auth_date_expired", now: nowSec, auth_date: authDate }, 401);

  // DCS варианты
  const variants = buildDcsVariants(initData);
  const clientHash = variants[0].hash;
  if (!clientHash) return json({ ok: false, reason: "hash_missing" }, 400);

  // КЛЮЧИ (все — RAW BYTES!)
  const k_webapp_raw = await hmacRawByKeyString("WebAppData", token); // Нужный ключ для Mini App
  const k_rev_raw    = await hmacRawByKeyString(token, "WebAppData"); // экзотика
  const k_sha_raw    = await sha256Raw(token);                        // legacy
  const k_token_raw  = te.encode(token).buffer;                       // legacy

  const keys: Array<{ label: string; key: ArrayBuffer }> = [
    { label: "HMAC(WebAppData->token)", key: k_webapp_raw },
    { label: "HMAC(token->WebAppData)", key: k_rev_raw },
    { label: "SHA256(token)",           key: k_sha_raw },
    { label: "token-key",               key: k_token_raw },
  ];

  // Перебор 32 комбинаций
  for (const d of variants) {
    for (const k of keys) {
      const expect = await hmacHexWithRawKey(k.key, d.dcs);
      if (expect === clientHash) {
        // ok — ставим куку
        let user: any = null;
        try {
          const uj = new URLSearchParams(initData).get("user");
          user = uj ? JSON.parse(uj) : null;
        } catch {}
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

        return json({ ok: true, user, sig_mode: `${d.label} + ${k.label}` }, 200, { "Set-Cookie": cookie });
      }
    }
  }

  // Если вдруг всё ещё нет совпадения
  return json({
    ok: false,
    reason: "invalid_signature",
    got: clientHash,
    tried: variants.flatMap(d => keys.map(k => `${d.label} + ${k.label}`)),
  }, 401);
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
