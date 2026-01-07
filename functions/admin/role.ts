import { Env, addAdminUserId, getUserFromRequest, getUserRole, json } from "../_utils";

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const { userId: requesterId, username } = getUserFromRequest(request);
  const uid = requesterId;
  if (!uid) return new Response("Unauthorized", { status: 401 });

  const role = await getUserRole(uid, env, username);
  if (role !== "admin") return new Response("Forbidden", { status: 403 });

  let body: { userId?: string } | null = null;
  try {
    body = await request.json<{ userId?: string }>();
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  const targetUserId = String(body?.userId || "").trim();
  if (!targetUserId) {
    return json({ ok: false, reason: "missing_user_id" }, 400);
  }
  if (!/^\d+$/.test(targetUserId)) {
    return json({ ok: false, reason: "invalid_user_id" }, 400);
  }

  await addAdminUserId(targetUserId, env);
  return json({ ok: true, userId: targetUserId });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405 });
