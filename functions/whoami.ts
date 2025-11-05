import { getUserIdFromRequest } from "./_utils";

export const onRequestGet: PagesFunction = async ({ request }) => {
  const uid = getUserIdFromRequest(request);
  return new Response(JSON.stringify({
    cookie: request.headers.get("Cookie") || null,
    uid,
  }), {
    headers: { "Content-Type": "application/json" }
  });
};