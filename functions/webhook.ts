import { Env, json } from "./api/_utils";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const verifyToken = env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return json({ error: "Missing env: WHATSAPP_VERIFY_TOKEN" }, 500);
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return json({ error: "Invalid verification" }, 403);
};

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    // ignore invalid JSON
  }

  console.log("Webhook payload:", JSON.stringify(payload));
  return new Response("OK", { status: 200 });
};