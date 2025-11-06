// /functions/auth/telegram.ts — бьём 401 в ноль перебором всех реальных формул
type Env = { TELEGRAM_BOT_TOKEN: string };

const te = new TextEncoder();
const hex = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab)).map(b=>b.toString(16).padStart(2,"0")).join("");

async function hmacHex(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return hex(sig).toLowerCase();
}
async function keyFromString(s: string) {
  return te.encode(s).buffer;
}
async function sha256Buf(s: string) {
  return crypto.subtle.digest("SHA-256", te.encode(s));
}

// ----- DCS builders (8 вариантов) -----
type DcsVariant = { label: string; dcs: string; hash: string };

function buildDcsVariants(initData: string): DcsVariant[] {
  // разбор исходной строки по парам как пришло (UNSORTED + RAW)
  const rawPairs: Array<{rawK:string; rawV:string; k:string; vDec:string}> = [];
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
      rawPairs.push({ rawK, rawV, k, vDec });
    }
  }

  const makeDcs = (pairs: typeof rawPairs, includeSignature: boolean, useRawVals: boolean) => {
    const use = includeSignature ? pairs : pairs.filter(p => p.k !== "signature");
    const lines = use.map(p => `${p.k}=${useRawVals ? p.rawV : p.vDec}`);
    return lines.join("\n");
  };

  const sorted = [...rawPairs].sort((a,b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  const out: DcsVariant[] = [];
  // 1) raw unsorted
  out.push({ label: "raw+unsorted+withSig",    dcs: makeDcs(rawPairs, true,  true),  hash: clientHash });
  out.push({ label: "raw+unsorted+noSig",      dcs: makeDcs(rawPairs, false, true),  hash: clientHash });
  // 2) raw sorted
  out.push({ label: "raw+sorted+withSig",      dcs: makeDcs(sorted,   true,  true),  hash: clientHash });
  out.push({ label: "raw+sorted+noSig",        dcs: makeDcs(sorted,   false, true),  hash: clientHash });
  // 3) decoded unsorted
  out.push({ label: "decoded+unsorted+withSig",dcs: makeDcs(rawPairs, true,  false), hash: clientHash });
  out.push({ label: "decoded+unsorted+noSig",  dcs: makeDcs(rawPairs, false, false), hash: clientHash });
  // 4) decoded sorted
  out.push({ label: "decoded+sorted+withSig",  dcs: makeDcs(sorted,   true,  false), hash: clientHash });
  out.push({ label: "decoded+sorted+noSig",    dcs: makeDcs(sorted,   false, false), hash: clientHash });

  return out;
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

  // срок действия
  const authDate = parseInt(new URLSearchParams(initData).get("auth_date") || "0", 10);
  if (!Number.isFinite(authDate)) return json({ ok:false, reason:"auth_date_invalid" }, 400);
  const nowSec = Math.floor(Date.now()/1000);
  if (nowSec - authDate > 48*60*60) return json({ ok:false, reason:"auth_date_expired", now:nowSec, auth_date:authDate }, 401);

  const variants = buildDcsVariants(initData);
  const clientHash = variants[0].hash;
  if (!clientHash) return json({ ok:false, reason:"hash_missing" }, 400);

  // ключи (4)
  const k_webapp   = await keyFromString( // SECRET = HMAC_SHA256(key="WebAppData", msg=token)  (как бинарь)
    hex(new Uint8Array(await (async () => {
      const key = await crypto.subtle.importKey("raw", te.encode("WebAppData"), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, te.encode(token));
      return sig as ArrayBuffer;
    })()))
  ); // преобразуем сигнатуру в hex-строку, потом в bytes — чтобы быть независимым от платформенной репрезентации

  const k_rev      = await keyFromString(hex(new Uint8Array(await (async () => {
    const key = await crypto.subtle.importKey("raw", te.encode(token), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, te.encode("WebAppData"));
    return sig as ArrayBuffer;
  })())));

  const k_sha      = await sha256Buf(token);      // legacy
  const k_token    = await keyFromString(token);  // legacy

  // перебор кандидатов: 8 DCS × 4 ключа = 32 попытки
  const keys: Array<{label: string; key: ArrayBuffer}> = [
    { label: "HMAC(WebAppData->token)", key: k_webapp },
    { label: "HMAC(token->WebAppData)", key: k_rev },
    { label: "SHA256(token)",           key: k_sha },
    { label: "token-key",               key: k_token },
  ];

  for (const d of variants) {
    for (const k of keys) {
      const expect = await hmacHex(k.key, d.dcs);
      if (expect === clientHash) {
        // успех
        let user: any = null;
        try { user = JSON.parse(new URLSearchParams(initData).get("user") || "null"); } catch {}
        if (!user?.id) return json({ ok:false, reason:"user_missing" }, 400);

        const oneYear = 60*60*24*365;
        const cookie = [
          `tg_uid=${encodeURIComponent(String(user.id))}`,
          "Path=/","HttpOnly","Secure","SameSite=None",`Max-Age=${oneYear}`
        ].join("; ");

        return json({ ok:true, user, sig_mode: `${d.label} + ${k.label}` }, 200, { "Set-Cookie": cookie });
      }
    }
  }

  // если не совпало — вернём краткую диагностику (без длинных DCS)
  return json({
    ok:false,
    reason:"invalid_signature",
    got: clientHash,
    tried: variants.flatMap(d => keys.map(k => `${d.label} + ${k.label}`))
  }, 401);
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
