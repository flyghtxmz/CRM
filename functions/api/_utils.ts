export type Env = {
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_WABA_ID?: string;
  WHATSAPP_API_VERSION?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_ID?: string;
  BOTZAP_KV?: KVNamespace;
  BOTZAP_DB?: D1Database;
  BOTZAP_AUDIO_R2?: R2Bucket;
  BOTZAP_AUDIO_BASE_URL?: string;
  BOTZAP_ADMIN_EMAIL?: string;
  BOTZAP_ADMIN_PASSWORD?: string;
  BOTZAP_SESSION_TTL?: string;
  SHORTENER_URL?: string;
  SHORTENER_API_KEY?: string;
  BOTZAP_TRACK_SECRET?: string;
  BOTZAP_CRON_SECRET?: string;
};

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

export function options() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function requireEnv(env: Env, key: keyof Env) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing env: ${String(key)}`);
  }
  return value;
}

export function apiVersion(env: Env) {
  return env.WHATSAPP_API_VERSION || "v19.0";
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export async function callGraph(
  path: string,
  token: string,
  body: unknown,
  version: string,
) {
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // leave as text
  }

  if (!res.ok) {
    const error = { status: res.status, data };
    throw error;
  }

  return data;
}

export function getCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  const parts = header.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return part.slice(name.length + 1);
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number) {
  return `botzap_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return "botzap_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function sessionTtlSeconds(env: Env) {
  const raw = env.BOTZAP_SESSION_TTL;
  const value = raw ? Number.parseInt(raw, 10) : 60 * 60 * 24 * 7;
  if (!Number.isFinite(value) || value <= 0) return 60 * 60 * 24 * 7;
  return value;
}

export function newSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getSession(request: Request, env: Env) {
  const kv = env.BOTZAP_KV;
  if (!kv) {
    return { error: "Missing KV binding", status: 500 } as const;
  }

  const token = getCookie(request, "botzap_session");
  if (!token) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  const data = await kv.get(`session:${token}`, "json");
  if (!data) {
    return { error: "Unauthorized", status: 401 } as const;
  }

  return { kv, token, data } as const;
}



