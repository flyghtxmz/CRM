import { Env, getSession, json, options } from "./_utils";

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
};

export const onRequestOptions = async () => options();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, Number(limitRaw || 100)));
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
  return json({ ok: true });
};
