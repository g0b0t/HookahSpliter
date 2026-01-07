import { Env, addAdminUserId, getUserIdFromRequest, getUserRole, json } from "../_utils";

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const uid = getUserIdFromRequest(request);
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const role = await getUserRole(uid, env);
  if (role !== "admin") return new Response("Forbidden", { status: 403 });

  let body: { userId?: string } | null = null;
  try {
    body = await request.json<{ userId?: string }>();
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  const userId = String(body?.userId || "").trim();
  if (!userId) {
    return json({ ok: false, reason: "missing_user_id" }, 400);
  }
  if (!/^\d+$/.test(userId)) {
    return json({ ok: false, reason: "invalid_user_id" }, 400);
  }

  await addAdminUserId(userId, env);
  return json({ ok: true, userId });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
