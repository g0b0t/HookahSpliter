type Env = { TELEGRAM_BOT_TOKEN: string };
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const t = env.TELEGRAM_BOT_TOKEN || "";
  const botId = t.includes(":") ? t.split(":")[0] : null;
  return new Response(JSON.stringify({ bot_id_from_token: botId }), {
    headers: { "Content-Type": "application/json" }
  });
};
