export type Env = {
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_WABA_ID?: string;
  WHATSAPP_API_VERSION?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
};

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
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