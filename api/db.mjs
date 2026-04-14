import { neon } from '@neondatabase/serverless';

let _sql;
function sql() {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  return _sql;
}

export async function query(text, params = []) {
  const s = sql();
  const rows = await s.query(text, params);
  return rows;
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

export async function initSchema() {
  const s = sql();

  await s`CREATE TABLE IF NOT EXISTS devices (
    device_id   TEXT PRIMARY KEY,
    id          TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    album_id    TEXT NOT NULL DEFAULT '',
    device_token_hash TEXT NOT NULL DEFAULT '',
    firmware_ver TEXT NOT NULL DEFAULT '',
    last_seen_at TIMESTAMPTZ,
    last_status  JSONB,
    last_check_in JSONB,
    last_library JSONB,
    pending_commands JSONB DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE TABLE IF NOT EXISTS operator_sessions (
    session_id  TEXT PRIMARY KEY,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE TABLE IF NOT EXISTS upload_sessions (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL DEFAULT 'UNASSIGNED',
    album_id    TEXT NOT NULL DEFAULT 'UNASSIGNED',
    source      TEXT NOT NULL DEFAULT 'operator',
    filename    TEXT NOT NULL DEFAULT '',
    mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    content_kind TEXT NOT NULL DEFAULT 'unknown',
    status      TEXT NOT NULL DEFAULT 'created',
    file_id     TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    sha256      TEXT NOT NULL DEFAULT '',
    upload_token_hash TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
  )`;

  await s`CREATE TABLE IF NOT EXISTS ingest_files (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL DEFAULT '',
    album_id    TEXT NOT NULL DEFAULT '',
    filename    TEXT NOT NULL DEFAULT '',
    blob_url    TEXT NOT NULL DEFAULT '',
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    sha256      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'staged',
    source      TEXT NOT NULL DEFAULT 'device-drop',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE TABLE IF NOT EXISTS capsules (
    id          TEXT PRIMARY KEY,
    album_id    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    version     TEXT NOT NULL DEFAULT '1',
    payload_blob_url TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE TABLE IF NOT EXISTS deliveries (
    id          TEXT PRIMARY KEY,
    capsule_id  TEXT NOT NULL REFERENCES capsules(id),
    device_id   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE TABLE IF NOT EXISTS firmware_versions (
    id          TEXT PRIMARY KEY,
    version     TEXT NOT NULL UNIQUE,
    blob_url    TEXT NOT NULL DEFAULT '',
    is_stable   BOOLEAN NOT NULL DEFAULT false,
    release_notes TEXT NOT NULL DEFAULT '',
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE TABLE IF NOT EXISTS device_events (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    track_path  TEXT NOT NULL DEFAULT '',
    track_title TEXT NOT NULL DEFAULT '',
    album_id    TEXT NOT NULL DEFAULT '',
    value       INT NOT NULL DEFAULT 1,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  await s`CREATE INDEX IF NOT EXISTS idx_device_events_device_id ON device_events(device_id)`;
  await s`CREATE INDEX IF NOT EXISTS idx_device_events_type ON device_events(event_type)`;
  await s`CREATE INDEX IF NOT EXISTS idx_device_events_created ON device_events(created_at)`;
}

let _schemaReady = false;
export async function ensureSchema() {
  if (_schemaReady) return;
  await initSchema();
  _schemaReady = true;
}
