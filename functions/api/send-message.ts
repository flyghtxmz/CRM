import { apiVersion, callGraph, Env, json, options, readJson, requireEnv } from "./_utils";

type SendBody = {
  to?: string;
  message?: string;
};

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const payload = await readJson<SendBody>(request);
    const to = (payload.to || "").trim();
    const message = (payload.message || "").trim();

    if (!to || !message) {
      return json({ error: "Missing to or message" }, 400);
    }

    const token = requireEnv(env, "WHATSAPP_TOKEN");
    const phoneNumberId = requireEnv(env, "WHATSAPP_PHONE_NUMBER_ID");
    const version = apiVersion(env);

    const body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    };

    const data = await callGraph(`${phoneNumberId}/messages`, token, body, version);
    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err }, 500);
  }
};