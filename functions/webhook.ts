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
  name?: string;
  direction?: "in" | "out";
  status?: string;
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
  rules?: Array<{ type?: string; op?: string; tag?: string }>;
  action?: { type?: string; tag?: string };
};

type Flow = {
  id: string;
  enabled?: boolean;
  data?: { nodes?: FlowNode[]; edges?: FlowEdge[] };
};

function messagePreview(message: any) {
  if (!message || !message.type) return "(mensagem)";
  if (message.type === "text") return message.text?.body || "(texto)";
  if (message.type === "image") return "[imagem]";
  if (message.type === "audio") return "[audio]";
  if (message.type === "video") return "[video]";
  if (message.type === "document") return "[documento]";
  if (message.type === "sticker") return "[sticker]";
  if (message.type === "location") return "[localizacao]";
  return `[${message.type}]`;
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

function evaluateCondition(node: FlowNode, contact: Contact) {
  const rules = Array.isArray(node.rules) ? node.rules : [];
  if (!rules.length) return false;
  const tags = new Set(contact.tags || []);
  return rules.every((rule) => {
    if (rule.type !== "tag" || !rule.tag) return false;
    if (rule.op === "is_not") return !tags.has(rule.tag);
    return tags.has(rule.tag);
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

async function sendTextMessage(env: Env, to: string, text: string) {
  const token = requireEnv(env, "WHATSAPP_TOKEN");
  const phoneNumberId = requireEnv(env, "WHATSAPP_PHONE_NUMBER_ID");
  const version = apiVersion(env);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  await callGraph(`${phoneNumberId}/messages`, token, body, version);
}

async function runFlow(env: Env, flow: Flow, contact: Contact) {
  if (!flow || flow.enabled === false) return;
  const nodes = Array.isArray(flow.data?.nodes) ? flow.data?.nodes : [];
  const edges = Array.isArray(flow.data?.edges) ? flow.data?.edges : [];
  if (!nodes.length || !edges.length) return;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const startNodes = nodes.filter(
    (node) =>
      node.type === "start" && node.trigger === "Quando usuario enviar mensagem",
  );
  if (!startNodes.length) return;

  const maxSteps = 40;
  for (const start of startNodes) {
    let currentId = start.id;
    let steps = 0;
    let edge = findNextEdge(edges, currentId, "default");
    while (edge && steps < maxSteps) {
      const node = nodesById.get(edge.to);
      if (!node) break;
      steps += 1;
      if (node.type === "condition") {
        const ok = evaluateCondition(node, contact);
        const branch = ok ? "yes" : "no";
        currentId = node.id;
        edge = findNextEdge(edges, currentId, branch);
        continue;
      }
      if (node.type === "action") {
        applyAction(node, contact);
      }
      if (node.type === "message") {
        const body = String(node.body || "").trim();
        if (body) {
          try {
            await sendTextMessage(env, contact.wa_id, body);
          } catch {
            // ignore send errors (24h window, etc.)
          }
        }
      }
      currentId = node.id;
      edge = findNextEdge(edges, currentId, "default");
    }
  }
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

  const contactsIndex = (await kv.get("contacts:index", "json")) as Contact[] | null;
  const contactList: Contact[] = Array.isArray(contactsIndex) ? contactsIndex : [];
  const flowIndex = (await kv.get("flows:index", "json")) as Flow[] | null;
  const flows: Flow[] = Array.isArray(flowIndex) ? flowIndex : [];
  let contactsChanged = false;

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

      for (const flow of flows) {
        await runFlow(env, flow, contactRecord);
      }

      contactRecord = upsertContactList(contactList, contactRecord);
      await kv.put(`contact:${waId}`, JSON.stringify(contactRecord));

      const threadKey = `thread:${waId}`;
      const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
      const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
      threadList.push({
        id: message.id,
        from: waId,
        timestamp: message.timestamp,
        type: message.type,
        text: messagePreview(message),
        name,
        direction: "in",
      });
      if (threadList.length > 50) {
        threadList.splice(0, threadList.length - 50);
      }
      await kv.put(threadKey, JSON.stringify(threadList));
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

  return new Response("OK", { status: 200 });
};

