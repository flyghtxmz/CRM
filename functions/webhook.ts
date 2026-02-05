import { Env, json } from "./api/_utils";

type Conversation = {
  wa_id: string;
  name?: string;
  last_message?: string;
  last_timestamp?: string | number;
  last_type?: string;
  last_direction?: "in" | "out";
};

type StoredMessage = {
  id?: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: string;
  name?: string;
  direction?: "in" | "out";
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

  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value || {};
  const messages = value.messages || [];
  const contacts = value.contacts || [];

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

  return new Response("OK", { status: 200 });
};