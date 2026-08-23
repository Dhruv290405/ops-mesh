-- OpsMesh migration 002: machine API keys for event ingestion.

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL UNIQUE,
  key_hash     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'event_ingest'
               CHECK (purpose IN ('event_ingest', 'admin')),
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_subject ON api_keys(subject, purpose) WHERE revoked_at IS NULL;

COMMENT ON TABLE api_keys IS 'Machine credentials for event sources. Only hashes are stored.';