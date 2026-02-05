import { Env, getSession, json, options, readJson } from "./_utils";

type Flow = {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: number;
  data: any;
};

type FlowBody = {
  id?: string;
  name?: string;
  enabled?: boolean;
  data?: any;
};

function newId() {
  if (crypto && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export const onRequestOptions = async () => options();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const list = (await session.kv.get("flows:index", "json")) as Flow[] | null;
  const flows = Array.isArray(list) ? list : [];

  if (id) {
    const flow = flows.find((item) => item.id === id);
    if (!flow) return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, data: flow });
  }

  return json({ ok: true, data: flows });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const body = await readJson<FlowBody>(request);
  const id = (body.id || "").trim() || newId();
  const name = (body.name || "Fluxo sem nome").trim() || "Fluxo sem nome";
  const enabled = body.enabled !== false;
  const data = body.data || {};

  const flow: Flow = {
    id,
    name,
    enabled,
    updatedAt: Date.now(),
    data,
  };

  const list = (await session.kv.get("flows:index", "json")) as Flow[] | null;
  const flows = Array.isArray(list) ? list : [];
  const idx = flows.findIndex((item) => item.id === id);
  if (idx >= 0) {
    flows[idx] = flow;
  } else {
    flows.unshift(flow);
  }

  await session.kv.put("flows:index", JSON.stringify(flows));
  return json({ ok: true, data: flow });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ ok: false, error: "Missing id" }, 400);

  const list = (await session.kv.get("flows:index", "json")) as Flow[] | null;
  const flows = Array.isArray(list) ? list : [];
  const next = flows.filter((item) => item.id !== id);
  await session.kv.put("flows:index", JSON.stringify(next));
  return json({ ok: true });
};
