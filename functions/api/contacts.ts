import { Env, getSession, json, options } from "./_utils";

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

export const onRequestOptions = async () => options();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const contact = (await session.kv.get(`contact:${id}`, "json")) as Contact | null;
    if (!contact) return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, data: contact });
  }

  const list = (await session.kv.get("contacts:index", "json")) as Contact[] | null;
  const contacts = Array.isArray(list) ? list : [];
  return json({ ok: true, data: contacts });
};
