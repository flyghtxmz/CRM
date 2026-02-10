import { Env, getSession, json, options, readJson } from "./_utils";
import { processWaitClickStates } from "../webhook";

type TrackBody = {
  wa_id?: string;
  short?: string;
  target?: string;
  ua?: string;
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
  media_url?: string;
  caption?: string;
  name?: string;
  direction?: "in" | "out";
  status?: string;
};

type DeviceType = "mobile" | "desktop" | "unknown";

type Contact = {
  wa_id: string;
  name?: string;
  tags?: string[];
  last_message?: string;
  last_timestamp?: string | number;
  last_type?: string;
  last_direction?: "in" | "out";
  last_status?: string;
  last_click_at?: number;
  last_click_id?: string;
  last_click_url?: string;
  last_click_device?: DeviceType;
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

function inferDeviceType(rawUa: string): DeviceType {
  const ua = String(rawUa || "").toLowerCase();
  if (!ua) return "unknown";

  const mobileHints = ["android", "iphone", "ipad", "ipod", "mobile", "windows phone", "opera mini"];
  if (mobileHints.some((hint) => ua.includes(hint))) {
    return "mobile";
  }

  const desktopHints = ["windows nt", "macintosh", "x11", "linux x86_64", "cros"];
  if (desktopHints.some((hint) => ua.includes(hint))) {
    return "desktop";
  }

  return "unknown";
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

  let body: TrackBody | null = null;
  try {
    body = await readJson<TrackBody>(request);
  } catch {
    body = null;
  }

  const waId = String(body?.wa_id || "").trim();
  if (!waId) {
    return json({ ok: false, error: "Missing wa_id" }, 400);
  }

  const link = String(body?.short || body?.target || "").trim();
  const match = link.match(/\/s\/([^/?#]+)/);
  const clickId = match ? match[1] : "";
  const ua = String(body?.ua || request.headers.get("user-agent") || "");
  const deviceType = inferDeviceType(ua);
  const message = `O ${waId} clicou no link (${deviceType})`;
  const ts = nowUnix();

  const contact = (await session.kv.get(`contact:${waId}`, "json")) as Contact | null;
  const contactsIndex = (await session.kv.get("contacts:index", "json")) as Contact[] | null;
  const contactList: Contact[] = Array.isArray(contactsIndex) ? contactsIndex : [];

  const updatedContact = upsertContactList(contactList, {
    wa_id: waId,
    name: contact?.name,
    tags: contact?.tags || [],
    last_message: message,
    last_timestamp: ts,
    last_type: "event",
    last_direction: "in",
    last_click_at: ts,
    last_click_id: clickId,
    last_click_url: link,
    last_click_device: deviceType,
  });

  await session.kv.put("contacts:index", JSON.stringify(contactList));
  await session.kv.put(`contact:${waId}`, JSON.stringify(updatedContact));

  const convoIndex = (await session.kv.get("conversations:index", "json")) as Conversation[] | null;
  const convoList: Conversation[] = Array.isArray(convoIndex) ? convoIndex : [];
  const convoExisting = convoList.find((item) => item.wa_id === waId);
  const conversation: Conversation = {
    wa_id: waId,
    name: convoExisting?.name || contact?.name,
    last_message: message,
    last_timestamp: ts,
    last_type: "event",
    last_direction: "in",
  };

  const filtered = convoList.filter((item) => item.wa_id !== waId);
  filtered.unshift(conversation);
  filtered.sort((a, b) => Number(b.last_timestamp || 0) - Number(a.last_timestamp || 0));
  if (filtered.length > 50) filtered.splice(50);
  await session.kv.put("conversations:index", JSON.stringify(filtered));

  const threadKey = `thread:${waId}`;
  const thread = (await session.kv.get(threadKey, "json")) as StoredMessage[] | null;
  const threadList: StoredMessage[] = Array.isArray(thread) ? thread : [];
  threadList.push({
    id: `click:${Date.now()}`,
    from: waId,
    timestamp: String(ts),
    type: "event",
    text: message,
    direction: "in",
  });
  if (threadList.length > 50) {
    threadList.splice(0, threadList.length - 50);
  }
  await session.kv.put(threadKey, JSON.stringify(threadList));

  let waitClick = { matched: 0, executed: 0, errors: 0 };
  try {
    waitClick = await processWaitClickStates(
      env,
      waId,
      {
        text: String(link || "click"),
        short: String(body?.short || ""),
        target: String(body?.target || ""),
        clickId: clickId,
      },
    );
  } catch {
    // keep test endpoint resilient
  }

  return json({ ok: true, device_type: deviceType, wait_click: waitClick });
};

