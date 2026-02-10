-- Botzap CRM D1 schema (v1)

CREATE TABLE IF NOT EXISTS contacts (
  wa_id TEXT PRIMARY KEY,
  name TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  last_message TEXT,
  last_timestamp INTEGER,
  last_type TEXT,
  last_direction TEXT,
  last_status TEXT,
  last_flow_trigger_at INTEGER,
  last_flow_trigger_msg_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_last_timestamp ON contacts(last_timestamp DESC);

CREATE TABLE IF NOT EXISTS conversations (
  wa_id TEXT PRIMARY KEY,
  name TEXT,
  last_message TEXT,
  last_timestamp INTEGER,
  last_type TEXT,
  last_direction TEXT,
  last_status TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_timestamp ON conversations(last_timestamp DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,
  message_id TEXT,
  local_id TEXT,
  from_wa TEXT,
  direction TEXT,
  timestamp INTEGER,
  type TEXT,
  text TEXT,
  media_url TEXT,
  caption TEXT,
  name TEXT,
  status TEXT,
  event_kind TEXT,
  event_state TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(message_id),
  UNIQUE(local_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_timestamp ON messages(wa_id, timestamp ASC, id ASC);

CREATE TABLE IF NOT EXISTS flow_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  wa_id TEXT,
  flow_id TEXT,
  flow_name TEXT,
  trigger TEXT,
  tags_before_json TEXT,
  tags_after_json TEXT,
  notes_json TEXT,
  repeat_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_flow_logs_ts ON flow_logs(ts DESC);

CREATE TABLE IF NOT EXISTS delay_job_claims (
  job_id TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delay_job_claims_claimed_at ON delay_job_claims(claimed_at DESC);

CREATE TABLE IF NOT EXISTS link_clicks (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  wa_id TEXT NOT NULL,
  click_id TEXT,
  short_url TEXT,
  target_url TEXT,
  device_type TEXT,
  flow_id TEXT,
  flow_name TEXT,
  node_id TEXT,
  block_name TEXT,
  shared_click INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_link_clicks_ts ON link_clicks(ts DESC);
CREATE INDEX IF NOT EXISTS idx_link_clicks_wa_id ON link_clicks(wa_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_link_clicks_flow ON link_clicks(flow_id, ts DESC);
