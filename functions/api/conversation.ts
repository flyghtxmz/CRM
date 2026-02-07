import { Env, getSession, json } from "./_utils";
import { processDueDelayJobs } from "../webhook";

type StoredMessage = {
  id?: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: string;
  media_url?: string;
  caption?: string;
  name?: string;
  direction?: "in" | "out";
  status?: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  try {
    await processDueDelayJobs(env, 20);
  } catch {
    // no-op, keep endpoint available
  }

  const url = new URL(request.url);
  const waId = (url.searchParams.get("wa_id") || "").trim();
  if (!waId) {
    return json({ ok: false, error: "Missing wa_id" }, 400);
  }

  const thread = (await session.kv.get(`thread:${waId}`, "json")) as StoredMessage[] | null;
  const data = Array.isArray(thread) ? thread : [];

  return json({ ok: true, data });
};

