// /functions/debug/verify.ts
type Env = { TELEGRAM_BOT_TOKEN: string };
const te = new TextEncoder();
const hex = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab)).map(b=>b.toString(16).padStart(2,"0")).join("");

async function sha256Raw(s: string) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); }
async function hmac(keyRaw: ArrayBuffer, msg: string) {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return hex(sig).toLowerCase();
}
async function hmacByToken(token: string, msg: string) {
  const raw = new TextEncoder().encode(token);
  const key = await crypto.subtle.importKey("raw", raw, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return hex(sig).toLowerCase();
}

function dcsRaw(s: string) {
  const parts = s.split("&").filter(Boolean);
  const map = new Map<string, { rawK:string; rawV:string }>();
  let hash = "";
  for (const p of parts) {
    const i = p.indexOf("=");
    const rawK = i>=0 ? p.slice(0,i) : p;
    const rawV = i>=0 ? p.slice(i+1) : "";
    const k = decodeURIComponent(rawK);
    if (k === "hash") { try { hash = decodeURIComponent(rawV).toLowerCase(); } catch { hash = rawV.toLowerCase(); } continue; }
    map.set(k, { rawK, rawV });
  }
  const keys = Array.from(map.keys()).sort();
  const dcs = keys.map(k => `${k}=${map.get(k)!.rawV}`).join("\n");
  return { dcs, hash, keys };
}
function dcsDecoded(s: string) {
  const usp = new URLSearchParams(s);
  const hash = (usp.get("hash") || "").toLowerCase();
  usp.delete("hash");
  const entries = Array.from(usp.entries()).sort(([a],[b]) => a.localeCompare(b));
  const dcs = entries.map(([k,v]) => `${k}=${v}`).join("\n");
  const keys = entries.map(([k]) => k);
  return { dcs, hash, keys };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const t = env.TELEGRAM_BOT_TOKEN || "";
  const { initData } = await request.json<any>().catch(()=>({}));
  if (!initData) return new Response(JSON.stringify({ ok:false, reason:"initData_required" }), { headers: { "Content-Type":"application/json" }, status: 400 });

  const raw = dcsRaw(initData);
  const dec = dcsDecoded(initData);
  const secret = await sha256Raw(t);

  const e_raw_sha = await hmac(secret, raw.dcs);
  const e_dec_sha = await hmac(secret, dec.dcs);
  const e_raw_tok = await hmacByToken(t, raw.dcs);
  const e_dec_tok = await hmacByToken(t, dec.dcs);

  return new Response(JSON.stringify({
    ok: true,
    got: raw.hash || dec.hash || null,
    keys_raw: raw.keys,
    keys_decoded: dec.keys,
    expected_raw_sha: e_raw_sha,
    expected_decoded_sha: e_dec_sha,
    expected_raw_token: e_raw_tok,
    expected_decoded_token: e_dec_tok
  }), { headers: { "Content-Type":"application/json" } });
};
