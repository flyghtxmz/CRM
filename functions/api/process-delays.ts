import { Env, json, options } from "./_utils";
import { processDueDelayJobs } from "../webhook";

function readSecret(request: Request) {
  const url = new URL(request.url);
  const fromQuery = (url.searchParams.get("secret") || "").trim();
  if (fromQuery) return fromQuery;

  const fromHeader =
    (request.headers.get("x-cron-secret") || "").trim() ||
    (request.headers.get("x-botzap-cron-secret") || "").trim();
  if (fromHeader) return fromHeader;

  const auth = (request.headers.get("authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return "";
}

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(1, Math.min(100, raw));
}

async function handle(request: Request, env: Env) {
  const configuredSecret = String(env.BOTZAP_CRON_SECRET || "").trim();
  if (!configuredSecret) {
    return json(
      {
        ok: false,
        error: "Missing env: BOTZAP_CRON_SECRET",
      },
      500,
    );
  }

  const incomingSecret = readSecret(request);
  if (!incomingSecret || incomingSecret !== configuredSecret) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const limit = parseLimit(request);
  const result = await processDueDelayJobs(env, limit);
  return json({
    ok: true,
    limit,
    processed: result.processed,
    errors: result.errors,
    ts: Date.now(),
  });
}

export const onRequestOptions = async () => options();
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => handle(request, env);
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => handle(request, env);

