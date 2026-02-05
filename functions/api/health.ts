import { Env, getSession, json, options } from "./_utils";

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  return json({
    ok: true,
    hasToken: Boolean(env.WHATSAPP_TOKEN),
    hasPhoneNumberId: Boolean(env.WHATSAPP_PHONE_NUMBER_ID),
    hasWabaId: Boolean(env.WHATSAPP_WABA_ID),
    apiVersion: env.WHATSAPP_API_VERSION || "v19.0",
  });
};