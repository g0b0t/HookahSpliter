import { Env, getUserIdFromRequest, json } from "../_utils";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const prefix = `user:${uid}:session:`;
  const items = await env.HOOKAH_DATA.list<{ id: string; title?: string; startedAt?: number; endedAt?: number; totalCost?: number }>({ prefix });

  // Отдаём только metadata (быстро)
  const metas = items.keys.map(k => ({
    id: k.metadata?.id || k.name.slice(prefix.length),
    title: k.metadata?.title ?? "",
    startedAt: k.metadata?.startedAt ?? 0,
    endedAt: k.metadata?.endedAt ?? 0,
    totalCost: k.metadata?.totalCost ?? 0,
  }));

  return json({ ok: true, sessions: metas });
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const body = await request.json<any>();
  const session = body.session || body; // допускаем оба варианта
  if (!session?.id) return json({ ok: false, reason: "missing session.id" }, 400);

  const key = `user:${uid}:session:${session.id}`;
  const meta = {
    id: session.id,
    title: session.title || session.name || `Сессия ${session.id}`,
    startedAt: session.startedAt || Date.now(),
    endedAt: session.endedAt || 0,
    totalCost: session.totalCost || 0,
  };

  await env.HOOKAH_DATA.put(key, JSON.stringify(session), { metadata: meta });
  return json({ ok: true, id: session.id, meta });
};
