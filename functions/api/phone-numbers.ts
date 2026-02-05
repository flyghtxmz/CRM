import { apiVersion, Env, getSession, json, options, requireEnv } from "./_utils";

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  try {
    const token = requireEnv(env, "WHATSAPP_TOKEN");
    const wabaId = requireEnv(env, "WHATSAPP_WABA_ID");
    const version = apiVersion(env);

    const res = await fetch(
      `https://graph.facebook.com/${version}/${wabaId}/phone_numbers`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // leave as text
    }

    if (!res.ok) {
      return json({ ok: false, status: res.status, data }, res.status);
    }

    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err }, 500);
  }
};