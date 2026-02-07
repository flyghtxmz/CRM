import { Env, getSession, json, options } from "./_utils";
import { processDueDelayJobs } from "../webhook";
import { dbGetContactById, dbGetContacts, dbUpsertContact } from "./_d1";

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

type TagBody = {
  wa_id?: string;
  tag?: string;
  action?: "add" | "remove";
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
  const id = url.searchParams.get("id");

  if (env.BOTZAP_DB) {
    if (id) {
      const fromDb = (await dbGetContactById(env, id)) as Contact | null;
      if (fromDb) return json({ ok: true, data: fromDb });
    } else {
      const fromDb = (await dbGetContacts(env, 300)) as Contact[];
      if (fromDb.length > 0) return json({ ok: true, data: fromDb });
    }
  }

  if (id) {
    const contact = (await session.kv.get(`contact:${id}`, "json")) as Contact | null;
    if (!contact) return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, data: contact });
  }

  const list = (await session.kv.get("contacts:index", "json")) as Contact[] | null;
  const contacts = Array.isArray(list) ? list : [];
  return json({ ok: true, data: contacts });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  let body: TagBody | null = null;
  try {
    body = (await request.json()) as TagBody;
  } catch {
    body = null;
  }

  if (!body?.wa_id || !body.tag) {
    return json({ ok: false, error: "Missing wa_id or tag" }, 400);
  }

  const action = body.action === "add" ? "add" : "remove";
  const contact = (await session.kv.get(`contact:${body.wa_id}`, "json")) as Contact | null;
  if (!contact) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  const tags = new Set(Array.isArray(contact.tags) ? contact.tags : []);
  if (action === "add") {
    tags.add(body.tag);
  } else {
    tags.delete(body.tag);
  }
  contact.tags = Array.from(tags);

  const list = (await session.kv.get("contacts:index", "json")) as Contact[] | null;
  const contacts = Array.isArray(list) ? list : [];
  const idx = contacts.findIndex((item) => item.wa_id === contact.wa_id);
  if (idx >= 0) {
    contacts[idx] = contact;
  } else {
    contacts.unshift(contact);
  }

  await session.kv.put(`contact:${contact.wa_id}`, JSON.stringify(contact));
  await session.kv.put("contacts:index", JSON.stringify(contacts));

  if (env.BOTZAP_DB) {
    await dbUpsertContact(env, {
      wa_id: contact.wa_id,
      name: contact.name,
      tags: contact.tags || [],
      last_message: contact.last_message,
      last_timestamp: contact.last_timestamp,
      last_type: contact.last_type,
      last_direction: contact.last_direction,
      last_status: contact.last_status,
    });
  }

  return json({ ok: true, data: contact });
};
