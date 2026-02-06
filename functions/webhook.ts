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
  body?: string;
  url?: string;
  image?: string;
};

type Flow = {
  id: string;
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

async function shortenUrl(env: Env, longUrl: string, imageUrl?: string) {
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

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

async function runFlow(
  env: Env,
  flow: Flow,
  contact: Contact,
  logNotes: string[],
): Promise<boolean> {
  if (!flow || flow.enabled === false) return;
  const nodes = Array.isArray(flow.data?.nodes) ? flow.data?.nodes : [];
  const edges = Array.isArray(flow.data?.edges) ? flow.data?.edges : [];
  if (!nodes.length || !edges.length) return false;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const startNodes = nodes.filter(
    (node) =>
      node.type === "start" && node.trigger === "Quando usuario enviar mensagem",
  );
  if (!startNodes.length) return false;

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
      if (node.type === "message" || node.type === "message_link" || node.type === "message_short") {
        const body = String(node.body || "").trim();
        let url = "";
        if (node.type !== "message") {
          url = applyVars(String(node.url || "").trim(), contact);
        }
        let image = "";
        if (node.type === "message_short") {
          image = String(node.image || "").trim();
        }
        let finalUrl = url;
        if (node.type === "message_short" && url) {
          const shortened = await shortenUrl(env, url, image);
          if (shortened) {
            finalUrl = shortened;
            logNotes.push(`short:${node.id}:ok`);
          } else {
            logNotes.push(`short:${node.id}:falha`);
          }
        }
        const text = finalUrl ? `${body}\n${finalUrl}`.trim() : body;
        if (text) {
          try {
            const data: any = await sendTextMessage(
              env,
              contact.wa_id,
              text,
              Boolean(finalUrl),
            );
            logNotes.push(`msg:${node.id}:ok`);

            const kv = env.BOTZAP_KV;
            if (kv) {
              const ts = await nowUnix();
              const convIndex = (await kv.get("conversations:index", "json")) as Conversation[] | null;
              const list: Conversation[] = Array.isArray(convIndex) ? convIndex : [];
              const conversation: Conversation = {
                wa_id: contact.wa_id,
                name: contact.name,
                last_message: text,
                last_timestamp: ts,
                last_type: "text",
                last_direction: "out",
                last_status: "sent",
              };
              await upsertConversation(kv, list, conversation);

              const threadKey = `thread:${contact.wa_id}`;
              const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
              const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
              threadList.push({
                id: data?.messages?.[0]?.id,
                from: "me",
                timestamp: String(ts),
                type: "text",
                text,
                direction: "out",
                status: "sent",
              });
              if (threadList.length > 50) {
                threadList.splice(0, threadList.length - 50);
              }
              await kv.put(threadKey, JSON.stringify(threadList));
            }
          } catch {
            // ignore send errors (24h window, etc.)
            logNotes.push(`msg:${node.id}:falhou`);
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

      let executedCount = 0;
      let logged = false;
      for (const flow of flows) {
        const tagsBefore = [...(contactRecord.tags || [])];
        const notes: string[] = [];
        const executed = await runFlow(env, flow, contactRecord, notes);
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

  if (logs.length) {
    if (logs.length > 200) logs.splice(200);
    await kv.put("flow-logs:index", JSON.stringify(logs));
  }

  return new Response("OK", { status: 200 });
};





