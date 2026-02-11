import {
  constantTimeEquals,
  Env,
  json,
  newSessionToken,
  readJson,
  sessionCookie,
  sessionTtlSeconds,
  sha256Hex,
} from "./_utils";

type LoginBody = {
  email?: string;
  password?: string;
};

const DEFAULT_LOGIN_RATE_LIMIT = 8;
const DEFAULT_LOGIN_RATE_WINDOW_SEC = 15 * 60;

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function getClientIp(request: Request) {
  const cfIp = String(request.headers.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;
  const forwarded = String(request.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "unknown";
  return String(forwarded.split(",")[0] || "unknown").trim();
}

async function readFailCount(kv: KVNamespace, key: string) {
  const raw = await kv.get(key);
  const count = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(count) || count < 0) return 0;
  return count;
}

async function bumpFailCount(kv: KVNamespace, key: string, ttlSec: number) {
  const current = await readFailCount(kv, key);
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSec });
  return next;
}

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

  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "").trim();

  const expectedEmail = String(env.BOTZAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const expectedPasswordHash = String(env.BOTZAP_ADMIN_PASSWORD_HASH || "").trim().toLowerCase();
  const expectedPasswordLegacy = String(env.BOTZAP_ADMIN_PASSWORD || "").trim();

  if (!expectedEmail) {
    return json({ ok: false, error: "Missing env: BOTZAP_ADMIN_EMAIL" }, 500);
  }

  if (!expectedPasswordHash && !expectedPasswordLegacy) {
    return json(
      {
        ok: false,
        error: "Missing env: BOTZAP_ADMIN_PASSWORD_HASH (recommended) or BOTZAP_ADMIN_PASSWORD",
      },
      500,
    );
  }

  const maxFailures = parseBoundedInt(env.BOTZAP_LOGIN_RATE_LIMIT, DEFAULT_LOGIN_RATE_LIMIT, 3, 100);
  const rateWindowSec = parseBoundedInt(env.BOTZAP_LOGIN_RATE_WINDOW, DEFAULT_LOGIN_RATE_WINDOW_SEC, 60, 24 * 60 * 60);

  const ip = getClientIp(request);
  const ipKey = `login:fail:ip:${ip}`;
  const emailKey = `login:fail:email:${email || "unknown"}`;

  const [ipFails, emailFails] = await Promise.all([
    readFailCount(kv, ipKey),
    readFailCount(kv, emailKey),
  ]);

  if (ipFails >= maxFailures || emailFails >= maxFailures) {
    return json(
      {
        ok: false,
        error: "Too many attempts. Try again later.",
        retry_after_seconds: rateWindowSec,
      },
      429,
    );
  }

  const emailValid = constantTimeEquals(email, expectedEmail);

  let passwordValid = false;
  if (expectedPasswordHash) {
    const providedHash = await sha256Hex(password);
    passwordValid = constantTimeEquals(providedHash, expectedPasswordHash);
  } else {
    passwordValid = constantTimeEquals(password, expectedPasswordLegacy);
  }

  if (!emailValid || !passwordValid) {
    await Promise.all([
      bumpFailCount(kv, ipKey, rateWindowSec),
      bumpFailCount(kv, emailKey, rateWindowSec),
    ]);
    return json({ ok: false, error: "Invalid credentials" }, 401);
  }

  await Promise.all([kv.delete(ipKey), kv.delete(emailKey)]);

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