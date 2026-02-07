import { apiVersion, callGraph, Env, json, requireEnv } from "./api/_utils";

type Conversation = {
  wa_id: string;
  name?: string;
  last_message?: string;
  last_timestamp?: string | number;
  last_type?: string;
  last_direction?: "in" | "out";
  last_status?: string;
};

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
  event_kind?: string;
  event_state?: string;
};

type Contact = {
  wa_id: string;
  name?: string;
  tags?: string[];
  last_message?: string;
  last_timestamp?: string | number;
  last_type?: string;
  last_direction?: "in" | "out";
  last_status?: string;
  last_flow_trigger_at?: number;
  last_flow_trigger_msg_id?: string;
};

type FlowEdge = {
  id?: string;
  from: string;
  to: string;
  branch?: string;
};

type FlowNode = {
  id: string;
  type: string;
  trigger?: string;
  rules?: Array<{ type?: string; op?: string; tag?: string; keyword?: string; value?: string }>;
  action?: { type?: string; tag?: string };
  body?: string;
  url?: string;
  image?: string;
  linkMode?: string;
  linkFormat?: string;
  delay_value?: number;
  delay_unit?: string;
};

type Flow = {
  id: string;
  name?: string;
  enabled?: boolean;
  data?: { nodes?: FlowNode[]; edges?: FlowEdge[] };
};

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

type DelayJob = {
  id: string;
  flow_id: string;
  flow_name?: string;
  wa_id: string;
  next_node_id: string;
  node_id?: string;
  due_at: number;
  event_id?: string;
  inbound_text?: string;
  created_at: number;
  retry_count?: number;
};

const FLOW_TRIGGER_DEBOUNCE_SEC = 10;
const FLOW_DELAY_INDEX_KEY = "flow-delay-jobs:index";
const MAX_DELAY_JOBS_PER_TICK = 20;



function messagePreview(message: any) {
  if (!message || !message.type) return "(mensagem)";
  if (message.type === "text") return message.text?.body || "(texto)";
  if (message.type === "image") {
    const caption = String(message.image?.caption || "").trim();
    return caption ? `[imagem] ${caption}` : "[imagem]";
  }
  if (message.type === "audio") return "[audio]";
  if (message.type === "video") return "[video]";
  if (message.type === "document") return "[documento]";
  if (message.type === "sticker") return "[sticker]";
  if (message.type === "location") return "[localizacao]";
  return `[${message.type}]`;
}


function messageConditionText(message: any) {
  if (!message || !message.type) return "";
  if (message.type === "text") return String(message.text?.body || "").trim();
  if (message.type === "image") return String(message.image?.caption || "").trim();
  if (message.type === "button") return String(message.button?.text || "").trim();
  if (message.type === "interactive") {
    const selected = String(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "").trim();
    if (selected) return selected;
  }
  return String(messagePreview(message) || "").trim();
}

function toNumber(value: unknown) {
  const num = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(num)) return 0;
  return num;
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  tags.forEach((tag) => {
    const normalized = String(tag || "").trim();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function applyVars(input: string, contact: Contact) {
  if (!input) return "";
  const waId = contact.wa_id || "";
  const encoded = encodeURIComponent(waId);
  return input.replace(/\{\{\s*(wa_id|phone|numero)\s*\}\}|\{(wa_id|phone|numero)\}/gi, encoded);
}

function shortenerBase(env: Env) {
  const raw = env.SHORTENER_URL || "https://encurtalink.pages.dev";
  return raw.replace(/\/+$/, "");
}

async function shortenUrl(env: Env, longUrl: string, imageUrl?: string, cid?: string) {
  if (!longUrl) return null;
  try {
    const base = shortenerBase(env);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (env.SHORTENER_API_KEY) {
      headers["x-api-key"] = env.SHORTENER_API_KEY;
    }
    const payload: Record<string, string> = { url: longUrl };
    if (imageUrl) {
      payload.image = imageUrl;
    }
    if (cid) {
      payload.cid = cid;
    }
    const res = await fetch(`${base}/api/shorten`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const shortUrl =
      data?.short ||
      data?.short_url ||
      data?.shortUrl ||
      data?.url ||
      data?.link;
    if (typeof shortUrl === "string" && shortUrl.startsWith("http")) {
      return shortUrl;
    }
  } catch {
    // ignore shortener failures
  }
  return null;
}
function applyShortFormat(shortUrl: string, format: string) {
  const value = String(shortUrl || "");
  if (!value) return value;
  const mode = String(format || "").toLowerCase();
  if (mode !== "html" && mode !== "jpg") return value;
  const suffix = mode === "html" ? ".html" : ".jpg";
  const parts = value.split("?");
  const base = parts[0];
  if (base.endsWith(suffix)) return value;
  const next = `${base}${suffix}`;
  return parts.length > 1 ? `${next}?${parts.slice(1).join("?")}` : next;
}
function parseDelayUnit(value: unknown) {
  const unit = String(value || "").toLowerCase();
  if (unit === "hours" || unit.startsWith("hora")) return "hours";
  if (unit === "minutes" || unit.startsWith("min")) return "minutes";
  return "seconds";
}

function parseDelayValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function delaySecondsFromNode(node: FlowNode) {
  const unit = parseDelayUnit(node.delay_unit || "seconds");
  const value = parseDelayValue(node.delay_value);
  if (value <= 0) return 0;
  if (unit === "hours") return value * 3600;
  if (unit === "minutes") return value * 60;
  return value;
}

function formatDelayHuman(value: number, unit: string) {
  if (unit === "hours") return `${value} hora${value === 1 ? "" : "s"}`;
  if (unit === "minutes") return `${value} minuto${value === 1 ? "" : "s"}`;
  return `${value} segundo${value === 1 ? "" : "s"}`;
}

function newDelayJobId() {
  return `delay:${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function enqueueDelayJob(kv: KVNamespace, job: DelayJob) {
  const current = (await kv.get(FLOW_DELAY_INDEX_KEY, "json")) as DelayJob[] | null;
  const jobs: DelayJob[] = Array.isArray(current) ? current : [];
  jobs.push(job);
  jobs.sort((a, b) => Number(a.due_at || 0) - Number(b.due_at || 0));
  if (jobs.length > 5000) {
    jobs.splice(0, jobs.length - 5000);
  }
  await kv.put(FLOW_DELAY_INDEX_KEY, JSON.stringify(jobs));
}

async function takeDueDelayJobs(kv: KVNamespace, nowSec: number, limit: number) {
  const current = (await kv.get(FLOW_DELAY_INDEX_KEY, "json")) as DelayJob[] | null;
  const jobs: DelayJob[] = Array.isArray(current) ? current : [];
  if (!jobs.length) return [] as DelayJob[];

  const due: DelayJob[] = [];
  const pending: DelayJob[] = [];

  for (const job of jobs) {
    if (Number(job?.due_at || 0) <= nowSec && due.length < limit) {
      due.push(job);
      continue;
    }
    pending.push(job);
  }

  if (due.length) {
    await kv.put(FLOW_DELAY_INDEX_KEY, JSON.stringify(pending));
  }

  return due;
}

function appendFlowLog(logs: FlowLog[], log: FlowLog) {
  logs.unshift(log);
  if (logs.length > 200) logs.splice(200);
}

function applyContactRecord(base: Contact, updated: Contact) {
  base.name = updated.name;
  base.tags = updated.tags;
  base.last_message = updated.last_message;
  base.last_timestamp = updated.last_timestamp;
  base.last_type = updated.last_type;
  base.last_direction = updated.last_direction;
  base.last_status = updated.last_status;
  base.last_flow_trigger_at = updated.last_flow_trigger_at;
  base.last_flow_trigger_msg_id = updated.last_flow_trigger_msg_id;
}

function upsertContactWithList(contactList: Contact[], contact: Contact) {
  const updated = upsertContactList(contactList, {
    wa_id: contact.wa_id,
    name: contact.name,
    tags: contact.tags || [],
    last_message: contact.last_message,
    last_timestamp: contact.last_timestamp,
    last_type: contact.last_type,
    last_direction: contact.last_direction,
    last_status: contact.last_status,
    last_flow_trigger_at: contact.last_flow_trigger_at,
    last_flow_trigger_msg_id: contact.last_flow_trigger_msg_id,
  });
  applyContactRecord(contact, updated);
  return updated;
}

function upsertLogAndContacts(
  contactList: Contact[],
  logs: FlowLog[],
  waId: string,
  flow: Flow | null,
  notes: string[],
  tagsBefore: string[],
  contact: Contact,
  trigger = "Quando usuario enviar mensagem",
) {
  const tagsAfter = [...(contact.tags || [])];
  if (notes.length || tagsBefore.join(",") !== tagsAfter.join(",")) {
    appendFlowLog(logs, {
      ts: Date.now(),
      wa_id: waId,
      flow_id: flow?.id,
      flow_name: flow?.name,
      trigger,
      tags_before: tagsBefore,
      tags_after: tagsAfter,
      notes,
    });
  }
  upsertContactWithList(contactList, contact);
}

function upsertContactList(list: Contact[], update: Contact) {
  const existing = list.find((item) => item.wa_id === update.wa_id);
  const merged: Contact = {
    ...(existing || { wa_id: update.wa_id, tags: [] }),
    ...update,
  };
  merged.tags = uniqueTags([...(existing?.tags || []), ...(update.tags || [])]);

  const next = list.filter((item) => item.wa_id !== update.wa_id);
  next.unshift(merged);
  next.sort((a, b) => toNumber(b.last_timestamp) - toNumber(a.last_timestamp));
  if (next.length > 200) next.splice(200);
  list.splice(0, list.length, ...next);

  return merged;
}

function normalizeSearchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function evaluateCondition(node: FlowNode, contact: Contact, inboundText = "") {
  const rules = Array.isArray(node.rules) ? node.rules : [];
  if (!rules.length) return false;
  const tags = new Set(contact.tags || []);
  const normalizedInboundText = normalizeSearchText(inboundText);
  return rules.every((rule) => {
    if (rule.type === "tag") {
      if (!rule.tag) return false;
      if (rule.op === "is_not") return !tags.has(rule.tag);
      return tags.has(rule.tag);
    }
    if (rule.type === "message_contains") {
      const keyword = normalizeSearchText(rule.keyword || rule.value || "");
      if (!keyword) return false;
      return normalizedInboundText.includes(keyword);
    }
    return false;
  });
}

function applyAction(node: FlowNode, contact: Contact) {
  if (!node.action || node.action.type !== "tag" || !node.action.tag) return;
  const tags = new Set(contact.tags || []);
  tags.add(node.action.tag);
  contact.tags = Array.from(tags);
}

function findNextEdge(edges: FlowEdge[], from: string, branch: string) {
  return edges.find(
    (edge) => edge.from === from && (edge.branch || "default") === branch,
  );
}

async function sendTextMessage(env: Env, to: string, text: string, preview = false) {
  const token = requireEnv(env, "WHATSAPP_TOKEN");
  const phoneNumberId = requireEnv(env, "WHATSAPP_PHONE_NUMBER_ID");
  const version = apiVersion(env);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: preview },
  };
  return callGraph(`${phoneNumberId}/messages`, token, body, version);
}

async function sendImageMessage(env: Env, to: string, imageUrl: string, caption = "") {
  const token = requireEnv(env, "WHATSAPP_TOKEN");
  const phoneNumberId = requireEnv(env, "WHATSAPP_PHONE_NUMBER_ID");
  const version = apiVersion(env);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageUrl,
      ...(caption ? { caption } : {}),
    },
  };
  return callGraph(`${phoneNumberId}/messages`, token, body, version);
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function makeLocalId() {
  return `local:${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function appendOutgoingMessage(
  kv: KVNamespace,
  contact: Contact,
  text: string,
  type: string,
  media?: { mediaUrl?: string; caption?: string },
) {
  const ts = nowUnix();
  const localId = makeLocalId();
  const convIndex = (await kv.get("conversations:index", "json")) as Conversation[] | null;
  const list: Conversation[] = Array.isArray(convIndex) ? convIndex : [];
  const conversation: Conversation = {
    wa_id: contact.wa_id,
    name: contact.name,
    last_message: text,
    last_timestamp: ts,
    last_type: type,
    last_direction: "out",
    last_status: "sending",
  };
  await upsertConversation(kv, list, conversation);

  const threadKey = `thread:${contact.wa_id}`;
  const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
  const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
  threadList.push({
    id: localId,
    from: "me",
    timestamp: String(ts),
    type,
    text,
    media_url: media?.mediaUrl,
    caption: media?.caption,
    direction: "out",
    status: "sending",
  });
  if (threadList.length > 50) {
    threadList.splice(0, threadList.length - 50);
  }
  await kv.put(threadKey, JSON.stringify(threadList));

  return { localId, ts };
}

async function finalizeOutgoingMessage(
  kv: KVNamespace,
  waId: string,
  localId: string,
  status: "sent" | "failed",
  messageId?: string,
) {
  const threadKey = `thread:${waId}`;
  const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
  if (Array.isArray(thread)) {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      if (thread[i].id === localId) {
        thread[i].status = status;
        if (messageId) thread[i].id = messageId;
        break;
      }
    }
    await kv.put(threadKey, JSON.stringify(thread));
  }

  const convIndex = (await kv.get("conversations:index", "json")) as Conversation[] | null;
  const list: Conversation[] = Array.isArray(convIndex) ? convIndex : [];
  const convo = list.find((item) => item.wa_id === waId && item.last_direction === "out");
  if (convo) {
    convo.last_status = status;
    await kv.put("conversations:index", JSON.stringify(list));
  }
}

async function appendFlowEvent(
  kv: KVNamespace,
  contact: Contact,
  text: string,
  eventState: "active" | "done",
) {
  const ts = nowUnix();
  const eventId = `event:delay:${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const convIndex = (await kv.get("conversations:index", "json")) as Conversation[] | null;
  const conversations: Conversation[] = Array.isArray(convIndex) ? convIndex : [];
  const conversation: Conversation = {
    wa_id: contact.wa_id,
    name: contact.name,
    last_message: text,
    last_timestamp: ts,
    last_type: "event",
    last_direction: "in",
  };
  await upsertConversation(kv, conversations, conversation);

  const contactIndex = (await kv.get("contacts:index", "json")) as Contact[] | null;
  const contactList: Contact[] = Array.isArray(contactIndex) ? contactIndex : [];
  const updatedContact = upsertContactList(contactList, {
    wa_id: contact.wa_id,
    name: contact.name,
    tags: contact.tags || [],
    last_message: text,
    last_timestamp: ts,
    last_type: "event",
    last_direction: "in",
  });
  await kv.put("contacts:index", JSON.stringify(contactList));
  await kv.put(`contact:${contact.wa_id}`, JSON.stringify(updatedContact));
  contact.last_message = updatedContact.last_message;
  contact.last_timestamp = updatedContact.last_timestamp;
  contact.last_type = updatedContact.last_type;
  contact.last_direction = updatedContact.last_direction;
  contact.tags = updatedContact.tags;

  const threadKey = `thread:${contact.wa_id}`;
  const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
  const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
  threadList.push({
    id: eventId,
    from: contact.wa_id,
    timestamp: String(ts),
    type: "event",
    text,
    direction: "in",
    event_kind: "delay",
    event_state: eventState,
  });
  if (threadList.length > 50) {
    threadList.splice(0, threadList.length - 50);
  }
  await kv.put(threadKey, JSON.stringify(threadList));

  return eventId;
}

async function updateFlowEvent(
  kv: KVNamespace,
  contact: Contact,
  eventId: string,
  text: string,
  eventState: "active" | "done",
) {
  const ts = nowUnix();
  const threadKey = `thread:${contact.wa_id}`;
  const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
  const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];

  let found = false;
  for (let i = threadList.length - 1; i >= 0; i -= 1) {
    if (threadList[i].id !== eventId) continue;
    threadList[i].text = text;
    threadList[i].event_kind = "delay";
    threadList[i].event_state = eventState;
    threadList[i].timestamp = String(ts);
    found = true;
    break;
  }

  if (!found) {
    threadList.push({
      id: eventId,
      from: contact.wa_id,
      timestamp: String(ts),
      type: "event",
      text,
      direction: "in",
      event_kind: "delay",
      event_state: eventState,
    });
  }

  if (threadList.length > 50) {
    threadList.splice(0, threadList.length - 50);
  }
  await kv.put(threadKey, JSON.stringify(threadList));

  const convIndex = (await kv.get("conversations:index", "json")) as Conversation[] | null;
  const conversations: Conversation[] = Array.isArray(convIndex) ? convIndex : [];
  const conversation: Conversation = {
    wa_id: contact.wa_id,
    name: contact.name,
    last_message: text,
    last_timestamp: ts,
    last_type: "event",
    last_direction: "in",
  };
  await upsertConversation(kv, conversations, conversation);

  const contactIndex = (await kv.get("contacts:index", "json")) as Contact[] | null;
  const contactList: Contact[] = Array.isArray(contactIndex) ? contactIndex : [];
  const updatedContact = upsertContactList(contactList, {
    wa_id: contact.wa_id,
    name: contact.name,
    tags: contact.tags || [],
    last_message: text,
    last_timestamp: ts,
    last_type: "event",
    last_direction: "in",
  });
  await kv.put("contacts:index", JSON.stringify(contactList));
  await kv.put(`contact:${contact.wa_id}`, JSON.stringify(updatedContact));
  contact.last_message = updatedContact.last_message;
  contact.last_timestamp = updatedContact.last_timestamp;
  contact.last_type = updatedContact.last_type;
  contact.last_direction = updatedContact.last_direction;
  contact.tags = updatedContact.tags;
}

async function runFlow(
  env: Env,
  flow: Flow,
  contact: Contact,
  logNotes: string[],
  inboundText: string,
  startNodeId?: string,
): Promise<boolean> {
  if (!flow || flow.enabled === false) return false;
  const nodes = Array.isArray(flow.data?.nodes) ? flow.data?.nodes : [];
  const edges = Array.isArray(flow.data?.edges) ? flow.data?.edges : [];
  if (!nodes.length || !edges.length) return false;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const entryNodeIds: string[] = [];

  if (startNodeId && nodesById.has(startNodeId)) {
    entryNodeIds.push(startNodeId);
  } else {
    const startNodes = nodes.filter(
      (node) =>
        node.type === "start" && node.trigger === "Quando usuario enviar mensagem",
    );
    if (!startNodes.length) return false;
    entryNodeIds.push(...startNodes.map((node) => node.id));
  }

  const maxSteps = 40;
  for (const entryNodeId of entryNodeIds) {
    let currentId = entryNodeId;
    let steps = 0;
    let edge: FlowEdge | undefined = startNodeId
      ? { from: "__resume__", to: entryNodeId, branch: "default" }
      : findNextEdge(edges, currentId, "default");

    while (edge && steps < maxSteps) {
      const node = nodesById.get(edge.to);
      if (!node) break;
      steps += 1;

      if (node.type === "condition") {
        const ok = evaluateCondition(node, contact, inboundText);
        const branch = ok ? "yes" : "no";
        logNotes.push(`cond:${node.id}:${ok ? "yes" : "no"}`);
        currentId = node.id;
        edge = findNextEdge(edges, currentId, branch);
        continue;
      }

      if (node.type === "action") {
        applyAction(node, contact);
        if (node.action?.type === "tag") {
          logNotes.push(`acao:tag:${node.action.tag || ""}`);
        }
      }

      if (node.type === "delay") {
        const delayUnit = parseDelayUnit(node.delay_unit || "seconds");
        const delayValue = parseDelayValue(node.delay_value);
        const delaySeconds = delaySecondsFromNode(node);

        if (delaySeconds > 0) {
          const nextAfterDelay = findNextEdge(edges, node.id, "default");
          if (!nextAfterDelay) {
            logNotes.push(`delay:${node.id}:sem_proximo`);
            currentId = node.id;
            edge = undefined;
            continue;
          }

          const kv = env.BOTZAP_KV;
          if (!kv) {
            logNotes.push(`delay:${node.id}:sem_kv`);
            currentId = node.id;
            edge = nextAfterDelay;
            continue;
          }

          const humanDelay = formatDelayHuman(delayValue, delayUnit);
          const activeText = `Delay Ativado: Tempo estimado da proxima acao ${humanDelay}`;
          const eventId = await appendFlowEvent(kv, contact, activeText, "active");
          const nowSec = nowUnix();

          await enqueueDelayJob(kv, {
            id: newDelayJobId(),
            flow_id: flow.id,
            flow_name: flow.name,
            wa_id: contact.wa_id,
            next_node_id: nextAfterDelay.to,
            node_id: node.id,
            due_at: nowSec + delaySeconds,
            event_id: eventId,
            inbound_text: inboundText,
            created_at: nowSec,
            retry_count: 0,
          });

          logNotes.push(`delay:${node.id}:queued:${delaySeconds}s`);
          currentId = node.id;
          edge = undefined;
          continue;
        }

        logNotes.push(`delay:${node.id}:ignorado`);
      }

      if (node.type === "message" || node.type === "message_link" || node.type === "message_short" || node.type === "message_image") {
        const body = String(node.body || "").trim();
        let url = "";
        if (node.type !== "message") {
          url = applyVars(String(node.url || "").trim(), contact);
        }
        let image = "";
        if (node.type === "message_short" || node.type === "message_image") {
          image = String(node.image || "").trim();
        }
        let finalUrl = url;
        const linkMode = String(node.linkMode || "first").toLowerCase();
        const linkFormat = String(node.linkFormat || "default").toLowerCase();
        if ((node.type === "message_short" || node.type === "message_image") && url) {
          const shortened = await shortenUrl(env, url, image, contact.wa_id);
          if (shortened) {
            finalUrl = applyShortFormat(shortened, linkFormat);
            logNotes.push(`short:${node.id}:ok`);
          } else {
            logNotes.push(`short:${node.id}:falha`);
          }
        }
        let text = body;
        if (finalUrl) {
          if (linkMode === "only") {
            text = finalUrl;
          } else if (linkMode === "last") {
            text = `${body}\n${finalUrl}`.trim();
          } else {
            text = `${finalUrl}\n${body}`.trim();
          }
        }
        if (node.type === "message_image") {
          if (!image) {
            logNotes.push(`msg:${node.id}:sem_imagem`);
          } else {
            const caption = text || "";
            const kv = env.BOTZAP_KV;
            let localId: string | null = null;
            if (kv) {
              const previewText = caption || "[imagem]";
              const local = await appendOutgoingMessage(
                kv,
                contact,
                previewText,
                "image",
                { mediaUrl: image, caption: caption || undefined },
              );
              localId = local.localId;
            }
            try {
              const data: any = await sendImageMessage(env, contact.wa_id, image, caption);
              logNotes.push(`msg:${node.id}:ok`);
              if (kv && localId) {
                await finalizeOutgoingMessage(
                  kv,
                  contact.wa_id,
                  localId,
                  "sent",
                  data?.messages?.[0]?.id,
                );
              }
            } catch {
              logNotes.push(`msg:${node.id}:falhou`);
              if (kv && localId) {
                await finalizeOutgoingMessage(kv, contact.wa_id, localId, "failed");
              }
            }
          }
        } else if (text) {
          const kv = env.BOTZAP_KV;
          let localId: string | null = null;
          if (kv) {
            const local = await appendOutgoingMessage(kv, contact, text, "text");
            localId = local.localId;
          }
          try {
            const data: any = await sendTextMessage(
              env,
              contact.wa_id,
              text,
              Boolean(finalUrl),
            );
            logNotes.push(`msg:${node.id}:ok`);
            if (kv && localId) {
              await finalizeOutgoingMessage(
                kv,
                contact.wa_id,
                localId,
                "sent",
                data?.messages?.[0]?.id,
              );
            }
          } catch {
            // ignore send errors (24h window, etc.)
            logNotes.push(`msg:${node.id}:falhou`);
            if (kv && localId) {
              await finalizeOutgoingMessage(kv, contact.wa_id, localId, "failed");
            }
          }
        }
      }

      currentId = node.id;
      edge = findNextEdge(edges, currentId, "default");
    }

    logNotes.push(`steps:${steps}`);
  }

  return true;
}

export async function processDueDelayJobs(env: Env, limit = MAX_DELAY_JOBS_PER_TICK) {
  const kv = env.BOTZAP_KV;
  if (!kv) return { processed: 0, errors: 0 };

  const safeLimit = Math.max(1, Math.min(MAX_DELAY_JOBS_PER_TICK, Number(limit) || MAX_DELAY_JOBS_PER_TICK));
  const dueJobs = await takeDueDelayJobs(kv, nowUnix(), safeLimit);
  if (!dueJobs.length) return { processed: 0, errors: 0 };

  const flowIndex = (await kv.get("flows:index", "json")) as Flow[] | null;
  const flows: Flow[] = Array.isArray(flowIndex) ? flowIndex : [];

  const logIndex = (await kv.get("flow-logs:index", "json")) as FlowLog[] | null;
  const logs: FlowLog[] = Array.isArray(logIndex) ? logIndex : [];

  let processed = 0;
  let errors = 0;

  for (const job of dueJobs) {
    try {
      const flow = flows.find((item) => item.id === job.flow_id && item.enabled !== false);
      if (!flow) {
        const missingContact = (await kv.get(`contact:${job.wa_id}`, "json")) as Contact | null;
        if (job.event_id) {
          try {
            await updateFlowEvent(
              kv,
              missingContact || { wa_id: job.wa_id, tags: [] },
              job.event_id,
              "Delay Concluido",
              "done",
            );
          } catch {
            // no-op
          }
        }
        appendFlowLog(logs, {
          ts: Date.now(),
          wa_id: job.wa_id,
          flow_id: job.flow_id,
          flow_name: "(delay sem fluxo)",
          trigger: "Delay concluido",
          notes: [`job:${job.id}`, "flow:nao_encontrado"],
        });
        continue;
      }

      const storedContact = (await kv.get(`contact:${job.wa_id}`, "json")) as Contact | null;
      const contact: Contact = storedContact
        ? { ...storedContact, tags: Array.isArray(storedContact.tags) ? storedContact.tags : [] }
        : { wa_id: job.wa_id, tags: [] };

      if (job.event_id) {
        await updateFlowEvent(kv, contact, job.event_id, "Delay Concluido", "done");
      } else {
        await appendFlowEvent(kv, contact, "Delay Concluido", "done");
      }

      const tagsBefore = [...(contact.tags || [])];
      const notes: string[] = [`delay_job:${job.id}:resume`];
      const executed = await runFlow(
        env,
        flow,
        contact,
        notes,
        String(job.inbound_text || ""),
        String(job.next_node_id || "").trim(),
      );
      if (!executed) {
        notes.push("resume:sem_execucao");
      }
      const tagsAfter = [...(contact.tags || [])];

      appendFlowLog(logs, {
        ts: Date.now(),
        wa_id: contact.wa_id,
        flow_id: flow.id,
        flow_name: flow.name,
        trigger: "Delay concluido",
        tags_before: tagsBefore,
        tags_after: tagsAfter,
        notes,
      });

      const contactIndex = (await kv.get("contacts:index", "json")) as Contact[] | null;
      const contactList: Contact[] = Array.isArray(contactIndex) ? contactIndex : [];
      const merged = upsertContactList(contactList, contact);
      await kv.put("contacts:index", JSON.stringify(contactList));
      await kv.put(`contact:${contact.wa_id}`, JSON.stringify(merged));

      processed += 1;
    } catch (err) {
      errors += 1;
      const messageText = err instanceof Error ? err.message : String(err || "erro");
      const retryCount = Number(job.retry_count || 0) + 1;
      if (retryCount <= 3) {
        await enqueueDelayJob(kv, {
          ...job,
          retry_count: retryCount,
          due_at: nowUnix() + 15,
        });
      }
      appendFlowLog(logs, {
        ts: Date.now(),
        wa_id: job.wa_id,
        flow_id: job.flow_id,
        flow_name: "(erro delay)",
        trigger: "Delay concluido",
        notes: [
          `job:${job.id}`,
          `erro:${messageText.slice(0, 180)}`,
          retryCount <= 3 ? `retry:${retryCount}` : "retry:max",
        ],
      });
    }
  }

  if (logs.length > 200) logs.splice(200);
  await kv.put("flow-logs:index", JSON.stringify(logs));

  return { processed, errors };
}
async function upsertConversation(
  kv: KVNamespace,
  list: Conversation[],
  conversation: Conversation,
) {
  const filtered = list.filter((item) => item.wa_id !== conversation.wa_id);
  filtered.unshift(conversation);
  list.splice(0, list.length, ...filtered);

  list.sort((a, b) => Number(b.last_timestamp || 0) - Number(a.last_timestamp || 0));
  if (list.length > 50) list.splice(50);

  await kv.put("conversations:index", JSON.stringify(list));
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const verifyToken = env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return json({ error: "Missing env: WHATSAPP_VERIFY_TOKEN" }, 500);
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return json({ error: "Invalid verification" }, 403);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  if (!payload) {
    return new Response("OK", { status: 200 });
  }

  const kv = env.BOTZAP_KV;
  if (!kv) {
    return new Response("OK", { status: 200 });
  }

  try {
    await processDueDelayJobs(env);
  } catch {
    // keep webhook resilient even if delay processor fails
  }

  const contactsIndex = (await kv.get("contacts:index", "json")) as Contact[] | null;
  const contactList: Contact[] = Array.isArray(contactsIndex) ? contactsIndex : [];
  const flowIndex = (await kv.get("flows:index", "json")) as Flow[] | null;
  const flows: Flow[] = Array.isArray(flowIndex) ? flowIndex : [];
  let contactsChanged = false;
  const logList = (await kv.get("flow-logs:index", "json")) as FlowLog[] | null;
  const logs: FlowLog[] = Array.isArray(logList) ? logList : [];

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value || {};
  const messages = value.messages || [];
  const statuses = value.statuses || [];
  const contacts = value.contacts || [];

  if (messages.length > 0) {
    const index = (await kv.get("conversations:index", "json")) as Conversation[] | null;
    const list: Conversation[] = Array.isArray(index) ? index : [];

    for (const message of messages) {
      const waId = message.from;
      if (!waId) continue;
      const contact = contacts.find((c: any) => c.wa_id === waId);
      const name = contact?.profile?.name;

      const conversation: Conversation = {
        wa_id: waId,
        name,
        last_message: messagePreview(message),
        last_timestamp: message.timestamp,
        last_type: message.type,
        last_direction: "in",
      };

      await upsertConversation(kv, list, conversation);

      const storedContact = (await kv.get(`contact:${waId}`, "json")) as Contact | null;
      let contactRecord = upsertContactList(contactList, {
        wa_id: waId,
        name: storedContact?.name || name,
        tags: storedContact?.tags || [],
        last_message: messagePreview(message),
        last_timestamp: message.timestamp,
        last_type: message.type,
        last_direction: "in",
      });
      contactsChanged = true;

      const threadKey = `thread:${waId}`;
      const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
      const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
      const incomingCaption =
        message.type === "image" ? String(message.image?.caption || "").trim() : "";
      threadList.push({
        id: message.id,
        from: waId,
        timestamp: message.timestamp,
        type: message.type,
        text: incomingCaption || messagePreview(message),
        caption: incomingCaption || undefined,
        name,
        direction: "in",
      });
      if (threadList.length > 50) {
        threadList.splice(0, threadList.length - 50);
      }
      await kv.put(threadKey, JSON.stringify(threadList));

      const inboundText = messageConditionText(message);
      let executedCount = 0;
      let logged = false;

      if (!flows.length) {
        logs.unshift({
          ts: Date.now(),
          wa_id: waId,
          flow_name: "(nenhum fluxo)",
          trigger: "Quando usuario enviar mensagem",
          tags_before: [...(contactRecord.tags || [])],
          tags_after: [...(contactRecord.tags || [])],
          notes: ["flows:0"],
        });
        logged = true;
      } else {
        const triggerTs = toNumber(message.timestamp) || nowUnix();
        const triggerContact = (await kv.get(`contact:${waId}`, "json")) as Contact | null;
        const lastTriggerTs = toNumber(triggerContact?.last_flow_trigger_at);
        const shouldRunFlow = triggerTs - lastTriggerTs > FLOW_TRIGGER_DEBOUNCE_SEC;

        if (!shouldRunFlow) {
          logs.unshift({
            ts: Date.now(),
            wa_id: waId,
            flow_name: "(gatilho ignorado)",
            trigger: "Quando usuario enviar mensagem",
            tags_before: [...(contactRecord.tags || [])],
            tags_after: [...(contactRecord.tags || [])],
            notes: [
              `debounce:${FLOW_TRIGGER_DEBOUNCE_SEC}s`,
              `last_trigger:${lastTriggerTs}`,
            ],
          });
          logged = true;
        } else {
          contactRecord.last_flow_trigger_at = triggerTs;
          contactRecord.last_flow_trigger_msg_id = message.id || "";

          // Persist trigger marker before flow run to avoid duplicate trigger in burst.
          contactRecord = upsertContactList(contactList, contactRecord);
          await kv.put(`contact:${waId}`, JSON.stringify(contactRecord));

          try {
            for (const flow of flows) {
              const tagsBefore = [...(contactRecord.tags || [])];
              const notes: string[] = [];
              const executed = await runFlow(env, flow, contactRecord, notes, inboundText);
              if (executed) executedCount += 1;
              const tagsAfter = [...(contactRecord.tags || [])];
              if (notes.length || tagsBefore.join(",") !== tagsAfter.join(",")) {
                logs.unshift({
                  ts: Date.now(),
                  wa_id: waId,
                  flow_id: flow.id,
                  flow_name: (flow as any)?.name,
                  trigger: "Quando usuario enviar mensagem",
                  tags_before: tagsBefore,
                  tags_after: tagsAfter,
                  notes,
                });
                logged = true;
              }
            }
          } catch (err) {
            const messageText = err instanceof Error ? err.message : String(err || "erro");
            logs.unshift({
              ts: Date.now(),
              wa_id: waId,
              flow_name: "(erro fluxo)",
              trigger: "Quando usuario enviar mensagem",
              tags_before: [...(contactRecord.tags || [])],
              tags_after: [...(contactRecord.tags || [])],
              notes: [`erro:${messageText.slice(0, 180)}`],
            });
            logged = true;
          }
        }
      }

      if (!logged) {
        logs.unshift({
          ts: Date.now(),
          wa_id: waId,
          flow_name: "(sem acao)",
          trigger: "Quando usuario enviar mensagem",
          tags_before: [...(contactRecord.tags || [])],
          tags_after: [...(contactRecord.tags || [])],
          notes: [`flows:${flows.length}`, `executados:${executedCount}`],
        });
      }

      contactRecord = upsertContactList(contactList, contactRecord);
      await kv.put(`contact:${waId}`, JSON.stringify(contactRecord));
    }
  }

  if (statuses.length > 0) {
    const index = (await kv.get("conversations:index", "json")) as Conversation[] | null;
    const list: Conversation[] = Array.isArray(index) ? index : [];
    let listChanged = false;

    for (const status of statuses) {
      const waId = status.recipient_id;
      const statusValue = status.status;
      if (!waId || !statusValue) continue;

      const threadKey = `thread:${waId}`;
      const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
      if (Array.isArray(thread)) {
        let updated = false;
        for (let i = thread.length - 1; i >= 0; i -= 1) {
          if (thread[i].id === status.id) {
            thread[i].status = statusValue;
            updated = true;
            break;
          }
        }
        if (updated) {
          await kv.put(threadKey, JSON.stringify(thread));
        }
      }

      const convo = list.find((item) => item.wa_id === waId);
      if (convo && convo.last_direction === "out") {
        convo.last_status = statusValue;
        listChanged = true;
      }

      const contactRecord = contactList.find((item) => item.wa_id === waId);
      if (contactRecord && contactRecord.last_direction === "out") {
        contactRecord.last_status = statusValue;
        contactsChanged = true;
        await kv.put(`contact:${waId}`, JSON.stringify(contactRecord));
      }
    }

    if (listChanged) {
      await kv.put("conversations:index", JSON.stringify(list));
    }
  }

  if (contactsChanged) {
    await kv.put("contacts:index", JSON.stringify(contactList));
  }

  if (logs.length) {
    if (logs.length > 200) logs.splice(200);
    await kv.put("flow-logs:index", JSON.stringify(logs));
  }

  return new Response("OK", { status: 200 });
};



















