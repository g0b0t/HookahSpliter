// /functions/debug/getme.ts
type Env = { TELEGRAM_BOT_TOKEN: string };

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const t = env.TELEGRAM_BOT_TOKEN || "";
  if (!t) return new Response(JSON.stringify({ ok:false, reason:"no_token" }), { headers: { "Content-Type":"application/json" }, status: 500 });

  const resp = await fetch(`https://api.telegram.org/bot${t}/getMe`);
  const j = await resp.json().catch(() => null);
  return new Response(JSON.stringify(j || { ok:false, reason:"fetch_failed" }), {
    headers: { "Content-Type":"application/json" }
  });
};
