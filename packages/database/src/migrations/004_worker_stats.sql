-- Worker + queue observability. Both the API and the worker share Postgres, so
-- stats live here (the in-memory Redis transport used in local dev is per-process
-- and would not be visible across the two processes).

CREATE TABLE IF NOT EXISTS worker_stats (
  worker_id      TEXT PRIMARY KEY,
  worker_type    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'RUNNING',
  jobs_processed BIGINT NOT NULL DEFAULT 0,
  failed_jobs    BIGINT NOT NULL DEFAULT 0,
  current_job    TEXT,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS queue_stats (
  queue_name      TEXT PRIMARY KEY,
  published       BIGINT NOT NULL DEFAULT 0,
  processing      BIGINT NOT NULL DEFAULT 0,
  completed       BIGINT NOT NULL DEFAULT 0,
  failed          BIGINT NOT NULL DEFAULT 0,
  completed_60s   BIGINT NOT NULL DEFAULT 0,
  rate_reset_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the known queues so the dashboard always has a stable set to render.
INSERT INTO queue_stats (queue_name) VALUES
  ('ingest'), ('realtime'), ('notifications'), ('escalation'), ('health'), ('metrics')
ON CONFLICT (queue_name) DO NOTHING;
