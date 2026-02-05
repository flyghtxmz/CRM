import { Env, getSession, json } from "./_utils";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  return json({ ok: true, data: session.data });
};