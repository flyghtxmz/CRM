import { Env, getSession, json, options, readJson } from "./_utils";
import {
  dbClearLinkClicks,
  dbClearLinkClicksByFlow,
  dbGetLinkClicks,
  dbGetLinkClicksSummary,
} from "./_d1";

type ClickRecord = {
  id?: string;
  ts?: number;
  wa_id?: string;
  click_id?: string;
  short_url?: string;
  target_url?: string;
  device_type?: string;
  flow_id?: string;
  flow_name?: string;
  node_id?: string;
  block_name?: string;
  shared_click?: number;
};

type ClickFlowSummary = {
  flow_id?: string;
  flow_name?: string;
  clicks: number;
};

type ClickBlockSummary = {
  flow_id?: string;
  flow_name?: string;
  node_id?: string;
  block_name?: string;
  clicks: number;
};

type ClearFlowBody = {
  flow_id?: string;
  flow_name?: string;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function matchesFlow(item: ClickRecord, flowId: string, flowName: string) {
  const itemFlowId = normalizeText(item.flow_id);
  const itemFlowName = normalizeText(item.flow_name);

  if (flowId && itemFlowId === flowId) return true;
  if (!flowName) return false;

  if (flowId && itemFlowId) return false;
  return itemFlowName.toLowerCase() === flowName.toLowerCase();
}

function summarizeClicks(list: ClickRecord[]) {
  const byFlowMap = new Map<string, ClickFlowSummary>();
  const byBlockMap = new Map<string, ClickBlockSummary>();
  const uniqueContacts = new Set<string>();
  let sharedClicks = 0;

  list.forEach((item) => {
    const waId = String(item.wa_id || "").trim();
    const flowId = String(item.flow_id || "").trim();
    const flowName = String(item.flow_name || "").trim();
    const nodeId = String(item.node_id || "").trim();
    const blockName = String(item.block_name || "").trim();
    if (waId) uniqueContacts.add(waId);
    if (toNumber(item.shared_click, 0) === 1) sharedClicks += 1;

    const flowKey = `${flowId}|${flowName}`;
    const prevFlow = byFlowMap.get(flowKey);
    if (prevFlow) {
      prevFlow.clicks += 1;
    } else {
      byFlowMap.set(flowKey, {
        flow_id: flowId || undefined,
        flow_name: flowName || undefined,
        clicks: 1,
      });
    }

    const blockKey = `${flowId}|${flowName}|${nodeId}|${blockName}`;
    const prevBlock = byBlockMap.get(blockKey);
    if (prevBlock) {
      prevBlock.clicks += 1;
    } else {
      byBlockMap.set(blockKey, {
        flow_id: flowId || undefined,
        flow_name: flowName || undefined,
        node_id: nodeId || undefined,
        block_name: blockName || undefined,
        clicks: 1,
      });
    }
  });

  const byFlow = Array.from(byFlowMap.values()).sort((a, b) => b.clicks - a.clicks);
  const byBlock = Array.from(byBlockMap.values()).sort((a, b) => b.clicks - a.clicks);

  return {
    total_clicks: list.length,
    unique_contacts: uniqueContacts.size,
    shared_clicks: sharedClicks,
    by_flow: byFlow.slice(0, 30),
    by_block: byBlock.slice(0, 30),
  };
}

export const onRequestOptions = async () => options();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(1000, toNumber(url.searchParams.get("limit"), 200)));

  if (env.BOTZAP_DB) {
    const summary = await dbGetLinkClicksSummary(env, 30);
    const recent = await dbGetLinkClicks(env, limit);
    if (summary.total_clicks > 0 || recent.length > 0) {
      return json({ ok: true, summary, data: recent });
    }
  }

  const kvList = (await session.kv.get("clicks:index", "json")) as ClickRecord[] | null;
  const list = Array.isArray(kvList) ? kvList : [];
  const recent = list.slice(0, limit);
  const summary = summarizeClicks(list);
  return json({ ok: true, summary, data: recent });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  await session.kv.put("clicks:index", JSON.stringify([]));
  if (env.BOTZAP_DB) {
    await dbClearLinkClicks(env);
  }

  return json({ ok: true, scope: "all" });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const body = await readJson<ClearFlowBody>(request);
  const flowId = normalizeText(body.flow_id);
  const flowName = normalizeText(body.flow_name);

  if (!flowId && !flowName) {
    return json({ ok: false, error: "flow_id ou flow_name e obrigatorio" }, 400);
  }

  const kvList = (await session.kv.get("clicks:index", "json")) as ClickRecord[] | null;
  const list = Array.isArray(kvList) ? kvList : [];
  const next = list.filter((item) => !matchesFlow(item, flowId, flowName));
  await session.kv.put("clicks:index", JSON.stringify(next));

  if (env.BOTZAP_DB) {
    await dbClearLinkClicksByFlow(env, flowId, flowName);
  }

  return json({ ok: true, scope: "flow", flow_id: flowId || null, flow_name: flowName || null });
};

