import { Env, json, options, requireEnv } from "./_utils";

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const verifyToken = requireEnv(env, "WHATSAPP_VERIFY_TOKEN");
    const url = new URL(request.url);
    const challenge = `botzap_${Date.now()}`;
    const callbackUrl = new URL("/webhook", url.origin);
    callbackUrl.searchParams.set("hub.mode", "subscribe");
    callbackUrl.searchParams.set("hub.verify_token", verifyToken);
    callbackUrl.searchParams.set("hub.challenge", challenge);

    const res = await fetch(callbackUrl.toString(), { method: "GET" });
    const text = await res.text();

    return json({
      ok: res.ok,
      status: res.status,
      response: text,
      expected: challenge,
      match: text === challenge,
    });
  } catch (err) {
    return json({ ok: false, error: err }, 500);
  }
};