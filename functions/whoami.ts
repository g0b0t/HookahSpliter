import { getUserFromRequest, getUserRole, json } from "./_utils";

function maskUid(uid: string | null): string | null {
  if (!uid) return null;
  if (uid.length <= 4) return "***";
  return `${uid.slice(0, 2)}***${uid.slice(-2)}`;
}

function isDevWhoamiAllowed(env: { WHOAMI_DEV_ENABLED?: string }) {
  return env.WHOAMI_DEV_ENABLED === "1" || env.WHOAMI_DEV_ENABLED === "true";
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const { userId, username } = getUserFromRequest(request);
  const role = await getUserRole(userId, env, username);
  const devAllowed = isDevWhoamiAllowed(env);

  if (role !== "admin" && !devAllowed) {
    return new Response("Forbidden", { status: 403 });
  }

  return json({
    authorized: Boolean(userId),
    uid: maskUid(userId),
  });
};
