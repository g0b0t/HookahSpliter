// functions/ping.ts
export const onRequest: PagesFunction = () =>
    new Response("pong", { headers: { "content-type": "text/plain" } });  