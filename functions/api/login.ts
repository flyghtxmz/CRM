import {
  Env,
  getSession,
  json,
  newSessionToken,
  readJson,
  sessionCookie,
  sessionTtlSeconds,
} from "./_utils";

type LoginBody = {
  email?: string;
  password?: string;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const kv = env.BOTZAP_KV;
  if (!kv) {
    return json({ ok: false, error: "Missing KV binding" }, 500);
  }

  let payload: LoginBody;
  try {
    payload = await readJson<LoginBody>(request);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 400);
  }

  const email = (payload.email || "").trim().toLowerCase();
  const password = (payload.password || "").trim();

  const expectedEmail = (env.BOTZAP_ADMIN_EMAIL || "test@test.com").trim().toLowerCase();
  const expectedPassword = (env.BOTZAP_ADMIN_PASSWORD || "1234").trim();

  if (email !== expectedEmail || password !== expectedPassword) {
    return json({ ok: false, error: "Invalid credentials" }, 401);
  }

  const token = newSessionToken();
  const ttl = sessionTtlSeconds(env);
  await kv.put(
    `session:${token}`,
    JSON.stringify({ email, ts: Date.now() }),
    { expirationTtl: ttl },
  );

  return json(
    { ok: true, email },
    200,
    { "set-cookie": sessionCookie(token, ttl) },
  );
};