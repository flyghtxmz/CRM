import { Env } from "./_utils";

export type DbConversation = {
  wa_id: string;
  name?: string;
  last_message?: string;
  last_timestamp?: string | number;
  last_type?: string;
  last_direction?: "in" | "out";
  last_status?: string;
};

export type DbContact = {
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

export type DbMessage = {
  id?: string;
  wa_id: string;
  from: string;
  timestamp?: string | number;
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

export type DbFlowLog = {
  ts: number;
  wa_id?: string;
  flow_id?: string;
  flow_name?: string;
  trigger?: string;
  tags_before?: string[];
  tags_after?: string[];
  notes?: string[];
  repeat_count?: number;
};

type RowMap = Record<string, unknown>;

function db(env: Env) {
  return env.BOTZAP_DB || null;
}

function toInt(value: unknown, fallback = 0) {
  const num = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.floor(num);
}

function toTs(value: unknown, fallback = 0) {
  const num = toInt(value, fallback);
  if (!num) return fallback;
  return num > 1e12 ? Math.floor(num / 1000) : num;
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function asString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function jsonArray(value: unknown) {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(value);
}

function parseArray(raw: unknown) {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw !== "string" || !raw.trim()) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed.map((v) => String(v));
  } catch {
    return [] as string[];
  }
}

function splitMessageId(id?: string) {
  const value = asString(id).trim();
  if (!value) return { messageId: null as string | null, localId: null as string | null };
  if (value.startsWith("local:") || value.startsWith("event:")) {
    return { messageId: null as string | null, localId: value };
  }
  return { messageId: value, localId: null as string | null };
}

export async function dbUpsertConversation(env: Env, conversation: DbConversation) {
  const database = db(env);
  if (!database) return;

  const timestamp = toTs(conversation.last_timestamp, nowTs());
  const updatedAt = nowTs();

  await database
    .prepare(
      `INSERT INTO conversations (
        wa_id, name, last_message, last_timestamp, last_type, last_direction, last_status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wa_id) DO UPDATE SET
        name=excluded.name,
        last_message=excluded.last_message,
        last_timestamp=excluded.last_timestamp,
        last_type=excluded.last_type,
        last_direction=excluded.last_direction,
        last_status=excluded.last_status,
        updated_at=excluded.updated_at`,
    )
    .bind(
      asString(conversation.wa_id),
      asString(conversation.name) || null,
      asString(conversation.last_message) || null,
      timestamp || null,
      asString(conversation.last_type) || null,
      asString(conversation.last_direction) || null,
      asString(conversation.last_status) || null,
      updatedAt,
    )
    .run();
}

export async function dbUpsertContact(env: Env, contact: DbContact) {
  const database = db(env);
  if (!database) return;

  const timestamp = toTs(contact.last_timestamp, nowTs());
  const updatedAt = nowTs();

  await database
    .prepare(
      `INSERT INTO contacts (
        wa_id, name, tags_json, last_message, last_timestamp, last_type, last_direction, last_status,
        last_flow_trigger_at, last_flow_trigger_msg_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wa_id) DO UPDATE SET
        name=excluded.name,
        tags_json=excluded.tags_json,
        last_message=excluded.last_message,
        last_timestamp=excluded.last_timestamp,
        last_type=excluded.last_type,
        last_direction=excluded.last_direction,
        last_status=excluded.last_status,
        last_flow_trigger_at=excluded.last_flow_trigger_at,
        last_flow_trigger_msg_id=excluded.last_flow_trigger_msg_id,
        updated_at=excluded.updated_at`,
    )
    .bind(
      asString(contact.wa_id),
      asString(contact.name) || null,
      jsonArray(contact.tags),
      asString(contact.last_message) || null,
      timestamp || null,
      asString(contact.last_type) || null,
      asString(contact.last_direction) || null,
      asString(contact.last_status) || null,
      toInt(contact.last_flow_trigger_at, 0) || null,
      asString(contact.last_flow_trigger_msg_id) || null,
      updatedAt,
    )
    .run();
}

export async function dbUpsertMessage(env: Env, message: DbMessage) {
  const database = db(env);
  if (!database) return;

  const ids = splitMessageId(message.id);
  const timestamp = toTs(message.timestamp, nowTs());
  const updatedAt = nowTs();

  const binds = [
    asString(message.wa_id),
    ids.messageId,
    ids.localId,
    asString(message.from) || null,
    asString(message.direction) || null,
    timestamp || null,
    asString(message.type) || null,
    asString(message.text) || null,
    asString(message.media_url) || null,
    asString(message.caption) || null,
    asString(message.name) || null,
    asString(message.status) || null,
    asString(message.event_kind) || null,
    asString(message.event_state) || null,
    updatedAt,
  ];

  if (ids.messageId) {
    await database
      .prepare(
        `INSERT INTO messages (
          wa_id, message_id, local_id, from_wa, direction, timestamp, type, text, media_url, caption,
          name, status, event_kind, event_state, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          wa_id=excluded.wa_id,
          local_id=COALESCE(excluded.local_id, messages.local_id),
          from_wa=excluded.from_wa,
          direction=excluded.direction,
          timestamp=excluded.timestamp,
          type=excluded.type,
          text=excluded.text,
          media_url=excluded.media_url,
          caption=excluded.caption,
          name=excluded.name,
          status=excluded.status,
          event_kind=excluded.event_kind,
          event_state=excluded.event_state,
          updated_at=excluded.updated_at`,
      )
      .bind(...binds)
      .run();
    return;
  }

  if (ids.localId) {
    await database
      .prepare(
        `INSERT INTO messages (
          wa_id, message_id, local_id, from_wa, direction, timestamp, type, text, media_url, caption,
          name, status, event_kind, event_state, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(local_id) DO UPDATE SET
          wa_id=excluded.wa_id,
          message_id=COALESCE(excluded.message_id, messages.message_id),
          from_wa=excluded.from_wa,
          direction=excluded.direction,
          timestamp=excluded.timestamp,
          type=excluded.type,
          text=excluded.text,
          media_url=excluded.media_url,
          caption=excluded.caption,
          name=excluded.name,
          status=excluded.status,
          event_kind=excluded.event_kind,
          event_state=excluded.event_state,
          updated_at=excluded.updated_at`,
      )
      .bind(...binds)
      .run();
    return;
  }

  await database
    .prepare(
      `INSERT INTO messages (
        wa_id, message_id, local_id, from_wa, direction, timestamp, type, text, media_url, caption,
        name, status, event_kind, event_state, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...binds)
    .run();
}

export async function dbFinalizeOutgoingMessage(
  env: Env,
  waId: string,
  localId: string,
  status: "sent" | "failed",
  messageId?: string,
) {
  const database = db(env);
  if (!database) return;

  const updatedAt = nowTs();
  await database
    .prepare(
      `UPDATE messages
      SET status=?, message_id=COALESCE(?, message_id), updated_at=?
      WHERE wa_id=? AND (local_id=? OR message_id=?)`,
    )
    .bind(status, asString(messageId) || null, updatedAt, asString(waId), asString(localId), asString(localId))
    .run();
}

export async function dbUpdateMessageStatusByMessageId(
  env: Env,
  waId: string,
  messageId: string,
  status: string,
) {
  const database = db(env);
  if (!database) return;

  await database
    .prepare(
      `UPDATE messages
      SET status=?, updated_at=?
      WHERE wa_id=? AND message_id=?`,
    )
    .bind(asString(status), nowTs(), asString(waId), asString(messageId))
    .run();
}

function mapConversationRow(row: RowMap): DbConversation {
  return {
    wa_id: asString(row.wa_id),
    name: asString(row.name) || undefined,
    last_message: asString(row.last_message) || undefined,
    last_timestamp: asString(row.last_timestamp) || undefined,
    last_type: asString(row.last_type) || undefined,
    last_direction: (asString(row.last_direction) as "in" | "out") || undefined,
    last_status: asString(row.last_status) || undefined,
  };
}

function mapContactRow(row: RowMap): DbContact {
  return {
    wa_id: asString(row.wa_id),
    name: asString(row.name) || undefined,
    tags: parseArray(row.tags_json),
    last_message: asString(row.last_message) || undefined,
    last_timestamp: asString(row.last_timestamp) || undefined,
    last_type: asString(row.last_type) || undefined,
    last_direction: (asString(row.last_direction) as "in" | "out") || undefined,
    last_status: asString(row.last_status) || undefined,
    last_flow_trigger_at: toInt(row.last_flow_trigger_at, 0) || undefined,
    last_flow_trigger_msg_id: asString(row.last_flow_trigger_msg_id) || undefined,
  };
}

export async function dbGetConversations(env: Env, limit = 50) {
  const database = db(env);
  if (!database) return [] as DbConversation[];

  const safeLimit = Math.max(1, Math.min(200, toInt(limit, 50)));
  const result = await database
    .prepare(
      `SELECT wa_id, name, last_message, last_timestamp, last_type, last_direction, last_status
      FROM conversations
      ORDER BY COALESCE(last_timestamp, 0) DESC
      LIMIT ?`,
    )
    .bind(safeLimit)
    .all<RowMap>();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows.map(mapConversationRow);
}

export async function dbGetContactById(env: Env, waId: string) {
  const database = db(env);
  if (!database) return null as DbContact | null;

  const row = await database
    .prepare(
      `SELECT wa_id, name, tags_json, last_message, last_timestamp, last_type, last_direction, last_status,
        last_flow_trigger_at, last_flow_trigger_msg_id
      FROM contacts
      WHERE wa_id=?
      LIMIT 1`,
    )
    .bind(asString(waId))
    .first<RowMap>();

  if (!row) return null;
  return mapContactRow(row);
}

export async function dbGetContacts(env: Env, limit = 200) {
  const database = db(env);
  if (!database) return [] as DbContact[];

  const safeLimit = Math.max(1, Math.min(500, toInt(limit, 200)));
  const result = await database
    .prepare(
      `SELECT wa_id, name, tags_json, last_message, last_timestamp, last_type, last_direction, last_status,
        last_flow_trigger_at, last_flow_trigger_msg_id
      FROM contacts
      ORDER BY COALESCE(last_timestamp, 0) DESC
      LIMIT ?`,
    )
    .bind(safeLimit)
    .all<RowMap>();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows.map(mapContactRow);
}

export async function dbGetMessagesByWaId(env: Env, waId: string, limit = 200) {
  const database = db(env);
  if (!database) return [] as DbMessage[];

  const safeLimit = Math.max(1, Math.min(500, toInt(limit, 200)));
  const result = await database
    .prepare(
      `SELECT id, wa_id, message_id, local_id, from_wa, direction, timestamp, type, text, media_url, caption,
        name, status, event_kind, event_state
      FROM messages
      WHERE wa_id=?
      ORDER BY COALESCE(timestamp, 0) ASC, id ASC
      LIMIT ?`,
    )
    .bind(asString(waId), safeLimit)
    .all<RowMap>();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows.map((row) => {
    const messageId = asString(row.message_id);
    const localId = asString(row.local_id);
    return {
      id: messageId || localId || "db:" + asString(row.id),
      wa_id: asString(row.wa_id),
      from: asString(row.from_wa) || asString(row.wa_id),
      direction: (asString(row.direction) as "in" | "out") || undefined,
      timestamp: asString(row.timestamp) || undefined,
      type: asString(row.type) || undefined,
      text: asString(row.text) || undefined,
      media_url: asString(row.media_url) || undefined,
      caption: asString(row.caption) || undefined,
      name: asString(row.name) || undefined,
      status: asString(row.status) || undefined,
      event_kind: asString(row.event_kind) || undefined,
      event_state: asString(row.event_state) || undefined,
    } as DbMessage;
  });
}

export async function dbInsertFlowLogs(env: Env, logs: DbFlowLog[]) {
  const database = db(env);
  if (!database || !Array.isArray(logs) || !logs.length) return;

  for (const log of logs) {
    await database
      .prepare(
        `INSERT INTO flow_logs (
          ts, wa_id, flow_id, flow_name, trigger, tags_before_json, tags_after_json, notes_json, repeat_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        toInt(log.ts, Date.now()),
        asString(log.wa_id) || null,
        asString(log.flow_id) || null,
        asString(log.flow_name) || null,
        asString(log.trigger) || null,
        jsonArray(log.tags_before),
        jsonArray(log.tags_after),
        jsonArray(log.notes),
        Math.max(1, toInt(log.repeat_count, 1)),
      )
      .run();
  }
}

export async function dbGetFlowLogs(env: Env, limit = 100) {
  const database = db(env);
  if (!database) return [] as DbFlowLog[];

  const safeLimit = Math.max(1, Math.min(500, toInt(limit, 100)));
  const result = await database
    .prepare(
      `SELECT ts, wa_id, flow_id, flow_name, trigger, tags_before_json, tags_after_json, notes_json, repeat_count
      FROM flow_logs
      ORDER BY ts DESC, id DESC
      LIMIT ?`,
    )
    .bind(safeLimit)
    .all<RowMap>();

  const rows = Array.isArray(result.results) ? result.results : [];
  return rows.map((row) => ({
    ts: toInt(row.ts, Date.now()),
    wa_id: asString(row.wa_id) || undefined,
    flow_id: asString(row.flow_id) || undefined,
    flow_name: asString(row.flow_name) || undefined,
    trigger: asString(row.trigger) || undefined,
    tags_before: parseArray(row.tags_before_json),
    tags_after: parseArray(row.tags_after_json),
    notes: parseArray(row.notes_json),
    repeat_count: Math.max(1, toInt(row.repeat_count, 1)),
  } as DbFlowLog));
}

export async function dbClearFlowLogs(env: Env) {
  const database = db(env);
  if (!database) return;

  await database.prepare(`DELETE FROM flow_logs`).run();
}

function isUniqueConstraintError(err: unknown) {
  const text = err instanceof Error ? err.message : String(err || "");
  const normalized = text.toLowerCase();
  return normalized.includes("unique") || normalized.includes("constraint");
}

function isMissingTableError(err: unknown, tableName: string) {
  const text = err instanceof Error ? err.message : String(err || "");
  const normalized = text.toLowerCase();
  return normalized.includes("no such table") && normalized.includes(tableName.toLowerCase());
}

// Returns:
// - true: claim created (job can run)
// - false: claim already exists (job must be skipped)
// - null: D1 unavailable/missing table (caller should fallback)
export async function dbTryClaimDelayJob(env: Env, jobId: string) {
  const database = db(env);
  if (!database) return null as boolean | null;

  try {
    await database
      .prepare(
        `INSERT INTO delay_job_claims (job_id, claimed_at)
        VALUES (?, ?)`,
      )
      .bind(asString(jobId), nowTs())
      .run();
    return true;
  } catch (err) {
    if (isUniqueConstraintError(err)) return false;
    if (isMissingTableError(err, "delay_job_claims")) return null as boolean | null;
    throw err;
  }
}

export async function dbReleaseDelayJobClaim(env: Env, jobId: string) {
  const database = db(env);
  if (!database) return;

  try {
    await database
      .prepare(`DELETE FROM delay_job_claims WHERE job_id=?`)
      .bind(asString(jobId))
      .run();
  } catch (err) {
    if (isMissingTableError(err, "delay_job_claims")) return;
    throw err;
  }
}
