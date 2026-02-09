export interface Env {
  CRM_BASE_URL: string;
  CRM_CRON_SECRET: string;
}

function normalizeBaseUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function runDelayTick(env: Env) {
  const base = normalizeBaseUrl(env.CRM_BASE_URL);
  if (!base) {
    throw new Error("Missing env: CRM_BASE_URL");
  }
  if (!env.CRM_CRON_SECRET) {
    throw new Error("Missing env: CRM_CRON_SECRET");
  }

  const res = await fetch(`${base}/api/process-delays?limit=50`, {
    method: "POST",
    headers: {
      "x-cron-secret": env.CRM_CRON_SECRET,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Delay tick failed: ${res.status} ${text.slice(0, 300)}`);
  }

  return text;
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runDelayTick(env));
  },
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      try {
        const raw = await runDelayTick(env);
        return new Response(raw, {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || "error");
        return new Response(JSON.stringify({ ok: false, error: message }, null, 2), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
