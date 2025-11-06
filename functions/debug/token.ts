type Env = { TELEGRAM_BOT_TOKEN: string };
const te = new TextEncoder();
const hex = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2,"0")).join("");

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const t = env.TELEGRAM_BOT_TOKEN || "";
  const ok = !!t;
  const h = ok ? await crypto.subtle.digest("SHA-256", te.encode(t)) : null;
  return new Response(JSON.stringify({ ok, token_sha256_8: h ? hex(h).slice(0,8) : null }), {
    headers: { "Content-Type": "application/json" }
  });
};