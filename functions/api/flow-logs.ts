import { Env, getSession, json, options } from "./_utils";
import { dbClearFlowLogs, dbGetFlowLogs } from "./_d1";
import { processDueDelayJobs } from "../webhook";

type FlowLog = {
  ts: number;
  wa_id?: string;
  flow_id?: string;
  flow_name?: string;
  trigger?: string;
  steps?: number;
  tags_before?: string[];
  tags_after?: string[];
  notes?: string[];
  repeat_count?: number;
};

export const onRequestOptions = async () => options();

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
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, Number(limitRaw || 100)));
  if (env.BOTZAP_DB) {
    const fromDb = (await dbGetFlowLogs(env, limit)) as FlowLog[];
    if (fromDb.length > 0) {
      return json({ ok: true, data: fromDb });
    }
  }

  const list = (await session.kv.get("flow-logs:index", "json")) as FlowLog[] | null;
  const logs = Array.isArray(list) ? list : [];
  return json({ ok: true, data: logs.slice(0, limit) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  await session.kv.put("flow-logs:index", JSON.stringify([]));
  if (env.BOTZAP_DB) {
    await dbClearFlowLogs(env);
  }
  return json({ ok: true });
};
