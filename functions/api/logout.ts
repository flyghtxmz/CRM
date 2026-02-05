import { Env, clearSessionCookie, getSession, json } from "./_utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if (!("error" in session)) {
    await session.kv.delete(`session:${session.token}`);
  }

  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
};