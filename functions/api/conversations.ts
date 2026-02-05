import { Env, getSession, json } from "./_utils";

type Conversation = {
  wa_id: string;
  name?: string;
  last_message?: string;
  last_timestamp?: string | number;
  last_type?: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit") || "20";
  const limit = Math.max(1, Math.min(50, Number.parseInt(limitRaw, 10) || 20));

  const list = (await session.kv.get("conversations:index", "json")) as Conversation[] | null;
  const data = Array.isArray(list) ? list.slice(0, limit) : [];

  return json({ ok: true, data });
};