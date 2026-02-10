import { Env, getSession, json, options, readJson } from "./_utils";
import { processWaitClickStates } from "../webhook";
import { dbInsertLinkClick, dbUpsertContact, dbUpsertConversation, dbUpsertMessage } from "./_d1";

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
  event_kind?: string;
  event_state?: string;
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

type FlowLinkMeta = {
  wa_id: string;
  flow_id?: string;
  flow_name?: string;
  node_id?: string;
  block_name?: string;
  short_id?: string;
  short_url?: string;
  target_url?: string;
  sent_at?: number;
};

type ClickRecord = {
  id: string;
  ts: number;
  wa_id: string;
  click_id?: string;
  short_url?: string;
  target_url?: string;
  device_type?: DeviceType;
  flow_id?: string;
  flow_name?: string;
  node_id?: string;
  block_name?: string;
  shared_click?: 0 | 1;
};

const FLOW_LINK_META_PREFIX = "flow-link-meta:";
const CLICKS_INDEX_KEY = "clicks:index";
const CLICKS_CACHE_LIMIT = 500;

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

function extractShortSlug(rawLink: string) {
  const value = String(rawLink || "").trim();
  if (!value) return "";
  const match = value.match(/\/s\/([A-Za-z0-9_-]+)(?:\.[A-Za-z0-9_-]+)?(?:[/?#]|$)/i);
  return match ? String(match[1] || "").trim() : "";
}

function flowLinkMetaKey(waId: string, shortId: string) {
  return `${FLOW_LINK_META_PREFIX}${waId}:${shortId}`;
}

function upsertContactList(list: Contact[], update: Contact) {
  const existing = list.find((item) => item.wa_id === update.wa_id);
  const merged: Contact = {
    ...(existing || { wa_id: update.wa_id, tags: [] }),
    ...update,
  };
  // `update.tags` is authoritative when provided (including empty array for removals).
  if (Array.isArray(update.tags)) {
    merged.tags = uniqueTags(update.tags);
  } else {
    merged.tags = uniqueTags(existing?.tags || []);
  }

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

  const ownerWaId = String(body?.wa_id || "").trim();
  const actorWaId = String(body?.wa_id || "").trim();
  if (!ownerWaId) {
    return json({ ok: false, error: "Missing wa_id" }, 400);
  }
  const waId = ownerWaId;

  const link = String(body?.short || body?.target || "").trim();
  const clickId = extractShortSlug(link);
  const ua = String(body?.ua || request.headers.get("user-agent") || "");
  const deviceType = inferDeviceType(ua);
  const isSharedClick = Boolean(actorWaId && ownerWaId && actorWaId !== ownerWaId);
  const linkMeta = clickId
    ? ((await session.kv.get(flowLinkMetaKey(waId, clickId), "json")) as FlowLinkMeta | null)
    : null;
  const flowSuffix = linkMeta?.flow_name
    ? ` | ${linkMeta.flow_name}${linkMeta.block_name ? ` (${linkMeta.block_name})` : ""}`
    : "";
  const message = `O ${waId} clicou no link (${deviceType})${flowSuffix}`;
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
  const eventId = `event:click:${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  threadList.push({
    id: eventId,
    from: waId,
    timestamp: String(ts),
    type: "event",
    text: message,
    direction: "in",
    event_kind: "click",
    event_state: "done",
  });
  if (threadList.length > 50) {
    threadList.splice(0, threadList.length - 50);
  }
  await session.kv.put(threadKey, JSON.stringify(threadList));

  const clickRecord: ClickRecord = {
    id: eventId,
    ts: Date.now(),
    wa_id: waId,
    click_id: clickId || undefined,
    short_url: String(body?.short || linkMeta?.short_url || "").trim() || undefined,
    target_url: String(body?.target || linkMeta?.target_url || "").trim() || undefined,
    device_type: deviceType,
    flow_id: String(linkMeta?.flow_id || "").trim() || undefined,
    flow_name: String(linkMeta?.flow_name || "").trim() || undefined,
    node_id: String(linkMeta?.node_id || "").trim() || undefined,
    block_name: String(linkMeta?.block_name || "").trim() || undefined,
    shared_click: isSharedClick ? 1 : 0,
  };

  const clickIndex = (await session.kv.get(CLICKS_INDEX_KEY, "json")) as ClickRecord[] | null;
  const clickList: ClickRecord[] = Array.isArray(clickIndex) ? clickIndex : [];
  clickList.unshift(clickRecord);
  if (clickList.length > CLICKS_CACHE_LIMIT) {
    clickList.splice(CLICKS_CACHE_LIMIT);
  }
  await session.kv.put(CLICKS_INDEX_KEY, JSON.stringify(clickList));

  if (env.BOTZAP_DB) {
    try {
      await dbUpsertContact(env, {
        wa_id: waId,
        name: updatedContact.name,
        tags: updatedContact.tags || [],
        last_message: message,
        last_timestamp: ts,
        last_type: "event",
        last_direction: "in",
      });

      await dbUpsertConversation(env, {
        wa_id: waId,
        name: conversation.name,
        last_message: message,
        last_timestamp: ts,
        last_type: "event",
        last_direction: "in",
      });

      await dbUpsertMessage(env, {
        id: eventId,
        wa_id: waId,
        from: waId,
        direction: "in",
        timestamp: ts,
        type: "event",
        text: message,
        event_kind: "click",
        event_state: "done",
      });
      await dbInsertLinkClick(env, clickRecord);
    } catch {
      // keep click test endpoint resilient if D1 write fails
    }
  }

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

