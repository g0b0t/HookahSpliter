import { Env, getUserIdFromRequest, json, defaultState } from "./_utils";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const key = `user:${uid}:state`;
  const data = await env.HOOKAH_DATA.get(key, "json");
  return json(data || defaultState());
};

export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const { state, clientRev } = await request.json<{ state: any; clientRev: number }>();
  const key = `user:${uid}:state`;
  const current: any = await env.HOOKAH_DATA.get(key, "json");
  const serverRev = current?._rev ?? 0;

  if (clientRev < serverRev) {
    return json({ ok: false, reason: "conflict", server: current }, 409);
  }

  const next = {
    ...(current || {}),
    ...(state || {}),
    _rev: serverRev + 1,
    updatedAt: Date.now(),
  };

  await env.HOOKAH_DATA.put(key, JSON.stringify(next));
  return json({ ok: true, state: next });
};
