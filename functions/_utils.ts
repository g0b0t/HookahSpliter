export type Env = {
  HOOKAH_DATA: KVNamespace;
  ADMIN_TG_UIDS?: string;
};

export type UserRole = "admin" | "user";
const ADMIN_LIST_KEY = "admin_uids";
const ADMIN_USERNAME_KEY = "admin_usernames";
const DEFAULT_ADMIN_USERNAMES = ["g0b0t"];

// Достаём tg_uid из cookie, который ставит ваш /auth/telegram
export function getUserIdFromRequest(req: Request): string | null {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)tg_uid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function getUsernameFromRequest(req: Request): string | null {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)tg_username=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function getUserFromRequest(req: Request) {
  return {
    userId: getUserIdFromRequest(req),
    username: getUsernameFromRequest(req),
  };
}

export function json(data: unknown, init: number | ResponseInit = 200) {
  return new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : init.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseAdminList(rawList: string) {
  return rawList
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export async function getAdminUserIds(env: Env) {
  const fromEnv = parseAdminList(env.ADMIN_TG_UIDS || "");
  const fromKv = await env.HOOKAH_DATA.get<string[]>(ADMIN_LIST_KEY, "json");
  if (!fromKv) {
    await env.HOOKAH_DATA.put(ADMIN_LIST_KEY, JSON.stringify(fromEnv));
  }
  const ids = new Set<string>(fromEnv);
  if (Array.isArray(fromKv)) {
    fromKv.forEach((id) => {
      if (typeof id === "string" && id.trim()) {
        ids.add(id.trim());
      }
    });
  }
  return ids;
}

export async function getAdminUsernames(env: Env) {
  const fromKv = await env.HOOKAH_DATA.get<string[]>(ADMIN_USERNAME_KEY, "json");
  if (!fromKv) {
    await env.HOOKAH_DATA.put(ADMIN_USERNAME_KEY, JSON.stringify(DEFAULT_ADMIN_USERNAMES));
  }
  const names = new Set<string>();
  DEFAULT_ADMIN_USERNAMES.forEach((name) => names.add(name.toLowerCase()));
  if (Array.isArray(fromKv)) {
    fromKv.forEach((name) => {
      if (typeof name === "string" && name.trim()) {
        names.add(name.trim().toLowerCase());
      }
    });
  }
  return names;
}

export async function addAdminUserId(userId: string, env: Env) {
  const ids = await getAdminUserIds(env);
  ids.add(userId);
  const list = [...ids];
  await env.HOOKAH_DATA.put(ADMIN_LIST_KEY, JSON.stringify(list));
  return list;
}

export async function getUserRole(
  userId: string | null,
  env: Env,
  username?: string | null,
): Promise<UserRole> {
  if (userId) {
    const ids = await getAdminUserIds(env);
    if (ids.has(userId)) return "admin";
  }
  if (username) {
    const names = await getAdminUsernames(env);
    if (names.has(username.toLowerCase())) return "admin";
  }
  return "user";
}

export function defaultState() {
  return {
    settings: { theme: "system", defaultBowlCost: 500 },
    people: [],
    currentSession: null,
    _rev: 0,
    updatedAt: Date.now(),
  };
}
