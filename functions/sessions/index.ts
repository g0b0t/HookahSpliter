import { Env, getUserIdFromRequest, json } from "../_utils";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const prefix = `user:${uid}:session:`;
  let cursor: string | undefined;
  const metas: Array<{ id: string; title: string; startedAt: number; endedAt: number; totalCost: number }> = [];

  while (true) {
    const page = await env.HOOKAH_DATA.list<{
      id: string;
      title?: string;
      startedAt?: number;
      endedAt?: number;
      totalCost?: number;
    }>({ prefix, cursor });

    for (const key of page.keys) {
      metas.push({
        id: key.metadata?.id || key.name.slice(prefix.length),
        title: key.metadata?.title ?? "",
        startedAt: key.metadata?.startedAt ?? 0,
        endedAt: key.metadata?.endedAt ?? 0,
        totalCost: key.metadata?.totalCost ?? 0,
      });
    }

    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  return json({ ok: true, sessions: metas });
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  let body: any;
  try {
    body = await request.json<any>();
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }
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
