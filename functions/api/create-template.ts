import { apiVersion, callGraph, Env, getSession, json, options, readJson, requireEnv } from "./_utils";

type TemplateBody = {
  name?: string;
  category?: string;
  language?: string;
  body?: string;
};

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  try {
    const payload = await readJson<TemplateBody>(request);
    const name = (payload.name || "").trim();
    const category = (payload.category || "").trim();
    const language = (payload.language || "").trim();
    const bodyText = (payload.body || "").trim();

    if (!name || !category || !language || !bodyText) {
      return json({ error: "Missing name, category, language, or body" }, 400);
    }

    const token = requireEnv(env, "WHATSAPP_TOKEN");
    const wabaId = requireEnv(env, "WHATSAPP_WABA_ID");
    const version = apiVersion(env);

    const body = {
      name,
      category,
      language,
      components: [
        {
          type: "BODY",
          text: bodyText,
        },
      ],
    };

    const data = await callGraph(`${wabaId}/message_templates`, token, body, version);
    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err }, 500);
  }
};