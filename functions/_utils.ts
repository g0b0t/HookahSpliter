export type Env = {
  HOOKAH_DATA: KVNamespace;
  ADMIN_TG_UIDS?: string;
};

export type UserRole = "admin" | "user";

// Достаём tg_uid из cookie, который ставит ваш /auth/telegram
export function getUserIdFromRequest(req: Request): string | null {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)tg_uid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function json(data: unknown, init: number | ResponseInit = 200) {
  return new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : init.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function getUserRole(userId: string, env: Env): UserRole {
  const rawList = env.ADMIN_TG_UIDS || "";
  const ids = rawList
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return ids.includes(userId) ? "admin" : "user";
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
