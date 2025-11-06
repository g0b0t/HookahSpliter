// functions/auth/logout.ts
// POST /auth/logout — очистка сессии (__Host-sid)

export const onRequestPost: PagesFunction = async () => {
    const clear = "tg_uid=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure";
    return new Response("", { status: 204, headers: { "Set-Cookie": clear } });
  };
  