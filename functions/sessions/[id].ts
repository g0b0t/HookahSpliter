import { Env, getUserFromRequest, getUserRole, json } from "../_utils";

export const onRequestGet: PagesFunction<Env> = async ({ env, request, params }) => {
  const { userId } = getUserFromRequest(request);
  const uid = userId;
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const id = params?.id as string;
  const key = `user:${uid}:session:${id}`;
  const data = await env.HOOKAH_DATA.get(key, "json");
  if (!data) return json({ ok: false, reason: "not_found" }, 404);
  return json({ ok: true, session: data });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, request, params }) => {
  const { userId, username } = getUserFromRequest(request);
  const uid = userId;
  if (!uid) return new Response("Unauthorized", { status: 401 });
  const role = await getUserRole(uid, env, username);
  if (role !== "admin") return new Response("Forbidden", { status: 403 });

  const id = params?.id as string;
  const key = `user:${uid}:session:${id}`;
  await env.HOOKAH_DATA.delete(key);
  return json({ ok: true });
};
