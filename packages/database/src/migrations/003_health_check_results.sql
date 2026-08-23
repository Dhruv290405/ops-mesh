-- OpsMesh migration 003: health check results log.

CREATE TABLE IF NOT EXISTS health_check_results (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'WARN')),
  latency_ms  INTEGER,
  status_code INTEGER,
  error       TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_health_results_service_time ON health_check_results(service_id, checked_at DESC);

COMMENT ON TABLE health_check_results IS 'Latest result drives service.status; history powers availability metrics.';