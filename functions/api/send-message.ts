import { apiVersion, callGraph, Env, getSession, json, options, readJson, requireEnv } from "./_utils";

type SendBody = {
  to?: string;
  message?: string;
};

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

function nowUnix() {
  return Math.floor(Date.now() / 1000);
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
  next.sort((a, b) => Number(b.last_timestamp || 0) - Number(a.last_timestamp || 0));
  if (next.length > 200) next.splice(200);
  list.splice(0, list.length, ...next);

  return merged;
}

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  try {
    const payload = await readJson<SendBody>(request);
    const to = (payload.to || "").trim();
    const message = (payload.message || "").trim();

    if (!to || !message) {
      return json({ error: "Missing to or message" }, 400);
    }

    const token = requireEnv(env, "WHATSAPP_TOKEN");
    const phoneNumberId = requireEnv(env, "WHATSAPP_PHONE_NUMBER_ID");
    const version = apiVersion(env);

    const body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    };

    const data: any = await callGraph(`${phoneNumberId}/messages`, token, body, version);

    const kv = env.BOTZAP_KV;
    if (kv) {
      const index = (await kv.get("conversations:index", "json")) as Conversation[] | null;
      const list: Conversation[] = Array.isArray(index) ? index : [];

      const existing = list.find((item) => item.wa_id === to);
      const conversation: Conversation = {
        wa_id: to,
        name: existing?.name,
        last_message: message,
        last_timestamp: nowUnix(),
        last_type: "text",
        last_direction: "out",
        last_status: "sent",
      };

      const filtered = list.filter((item) => item.wa_id !== to);
      filtered.unshift(conversation);
      filtered.sort((a, b) => Number(b.last_timestamp || 0) - Number(a.last_timestamp || 0));
      if (filtered.length > 50) filtered.splice(50);
      await kv.put("conversations:index", JSON.stringify(filtered));

      const contactIndex = (await kv.get("contacts:index", "json")) as Contact[] | null;
      const contactList: Contact[] = Array.isArray(contactIndex) ? contactIndex : [];
      const storedContact = (await kv.get(`contact:${to}`, "json")) as Contact | null;
      const contactRecord = upsertContactList(contactList, {
        wa_id: to,
        name: storedContact?.name || existing?.name,
        tags: storedContact?.tags || [],
        last_message: message,
        last_timestamp: nowUnix(),
        last_type: "text",
        last_direction: "out",
        last_status: "sent",
      });
      await kv.put("contacts:index", JSON.stringify(contactList));
      await kv.put(`contact:${to}`, JSON.stringify(contactRecord));

      const threadKey = `thread:${to}`;
      const thread = (await kv.get(threadKey, "json")) as StoredMessage[] | null;
      const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
      threadList.push({
        id: data?.messages?.[0]?.id,
        from: "me",
        timestamp: String(nowUnix()),
        type: "text",
        text: message,
        direction: "out",
        status: "sent",
      });
      if (threadList.length > 50) {
        threadList.splice(0, threadList.length - 50);
      }
      await kv.put(threadKey, JSON.stringify(threadList));
    }

    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err }, 500);
  }
};
