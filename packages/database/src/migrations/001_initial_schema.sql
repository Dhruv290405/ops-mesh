-- OpsMesh initial schema
-- Target: Supabase PostgreSQL 17. All identifiers lowercase, timestamps UTC.

-- =============================================================================
-- 1. USERS & TEAMS
-- =============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE teams IS 'Operational units that own services and run on-call rotations';

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'VIEWER'
                CHECK (role IN ('ADMIN', 'ENGINEER', 'VIEWER')),
  team_id       TEXT REFERENCES teams(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_team ON users(team_id);

COMMENT ON TABLE users IS 'Platform users (engineers, admins, viewers). Roles drive RBAC.';

-- =============================================================================
-- 2. SERVICES (service registry)
-- =============================================================================

CREATE TABLE IF NOT EXISTS services (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  description           TEXT,
  environment           TEXT NOT NULL DEFAULT 'production'
                        CHECK (environment IN ('development', 'staging', 'production')),
  owner_team_id         TEXT REFERENCES teams(id) ON DELETE SET NULL,
  health_check_url      TEXT,
  health_check_method   TEXT NOT NULL DEFAULT 'GET',
  health_check_timeout  INTEGER NOT NULL DEFAULT 5000,
  health_check_interval INTEGER NOT NULL DEFAULT 60000,
  expected_status       INTEGER NOT NULL DEFAULT 200,
  criticality           TEXT NOT NULL DEFAULT 'MEDIUM'
                        CHECK (criticality IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  sla_minutes           INTEGER,
  status                TEXT NOT NULL DEFAULT 'UNKNOWN'
                        CHECK (status IN ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN', 'MAINTENANCE')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_services_status ON services(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_services_team ON services(owner_team_id);

-- =============================================================================
-- 3. EVENTS (ingested reliability events)
-- =============================================================================

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  message     TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id  TEXT,
  fingerprint TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- duplicate-suppression guard on the producer path (Redis is primary,
-- this is the durable fallback) + incident lookup by fingerprint
CREATE INDEX idx_events_fingerprint ON events(fingerprint, created_at DESC);
CREATE INDEX idx_events_service_time ON events(service_id, timestamp DESC);
CREATE INDEX idx_events_type ON events(event_type, timestamp DESC);

COMMENT ON TABLE events IS 'Raw reliability events after validation/fingerprinting';

-- =============================================================================
-- 4. INCIDENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS incidents (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT,
  service_id          TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  severity            TEXT NOT NULL CHECK (severity IN ('SEV-1','SEV-2','SEV-3','SEV-4')),
  status              TEXT NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','MITIGATED','RESOLVED','ESCALATED')),
  priority            TEXT NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
  assigned_engineer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at     TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  escalation_level    INTEGER NOT NULL DEFAULT 0,
  event_count         INTEGER NOT NULL DEFAULT 1,
  dedupe_key          TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dashboard "active incidents" (perfect for OpenOverride on Postgres 14+ -- unused here, keep simple)
CREATE INDEX idx_incidents_active ON incidents(service_id, created_at DESC)
  WHERE status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','MITIGATED','ESCALATED');
CREATE INDEX idx_incidents_service ON incidents(service_id, created_at DESC);
CREATE INDEX idx_incidents_assignee ON incidents(assigned_engineer_id) WHERE assigned_engineer_id IS NOT NULL;
CREATE INDEX idx_incidents_created ON incidents(created_at DESC);

COMMENT ON TABLE incidents IS 'Incident records; state machine enforced in app layer.';

-- Events attached to incidents
CREATE TABLE IF NOT EXISTS incident_events (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (incident_id, event_id)
);

CREATE INDEX idx_incident_events_event ON incident_events(event_id);

-- Timeline of everything that happened on an incident
CREATE TABLE IF NOT EXISTS incident_timeline (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  message     TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_incident ON incident_timeline(incident_id, created_at DESC);

-- Assignment history (who was assigned when, by whom)
CREATE TABLE IF NOT EXISTS incident_assignments (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_incident ON incident_assignments(incident_id, created_at DESC);

-- =============================================================================
-- 5. ESCALATION
-- =============================================================================

CREATE TABLE IF NOT EXISTS escalation_policies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  service_id  TEXT REFERENCES services(id) ON DELETE CASCADE,
  team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- a service may only have one active policy at a time (partial unique index)
CREATE UNIQUE INDEX idx_escalation_policy_service ON escalation_policies(service_id) WHERE service_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS escalation_steps (
  id             TEXT PRIMARY KEY,
  policy_id      TEXT NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  level          INTEGER NOT NULL,
  delay_minutes  INTEGER NOT NULL DEFAULT 5,
  target_type    TEXT NOT NULL CHECK (target_type IN ('USER','TEAM','SCHEDULE')),
  target_id      TEXT NOT NULL,
  notify_channels TEXT[] NOT NULL DEFAULT '{"EMAIL","WEBHOOK"}',
  UNIQUE (policy_id, level)
);

CREATE INDEX idx_escalation_steps_policy ON escalation_steps(policy_id, level);

-- Escalation executions: what actually happened on an incident
CREATE TABLE IF NOT EXISTS escalation_executions (
  id            TEXT PRIMARY KEY,
  incident_id   TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  policy_id     TEXT REFERENCES escalation_policies(id) ON DELETE SET NULL,
  step_level    INTEGER NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  target_name   TEXT,
  reason        TEXT NOT NULL DEFAULT 'NO_ACKNOWLEDGEMENT',
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_escalations_incident ON escalation_executions(incident_id, triggered_at DESC);

-- =============================================================================
-- 6. ON-CALL
-- =============================================================================

CREATE TABLE IF NOT EXISTS on_call_schedules (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  rotation_order TEXT[] NOT NULL DEFAULT '{}',
  start_time   TEXT NOT NULL DEFAULT '00:00',
  end_time     TEXT NOT NULL DEFAULT '23:59',
  escalation_target_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oncall_team ON on_call_schedules(team_id);

-- Current on-call per team/schedule, continuously recomputed by worker;
-- kept in Redis for hot reads, this table is the durable record.
CREATE TABLE IF NOT EXISTS on_call_shifts (
  id           TEXT PRIMARY KEY,
  schedule_id  TEXT NOT NULL REFERENCES on_call_schedules(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_schedule_time ON on_call_shifts(schedule_id, starts_at DESC);

-- =============================================================================
-- 7. NOTIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id               TEXT PRIMARY KEY,
  incident_id      TEXT REFERENCES incidents(id) ON DELETE CASCADE,
  channel          TEXT NOT NULL CHECK (channel IN ('EMAIL','WEBHOOK','SLACK')),
  recipient        TEXT NOT NULL,
  subject          TEXT,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','SENT','FAILED','RETRYING')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  last_attempt_at  TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_status ON notifications(status, created_at DESC);
CREATE INDEX idx_notifications_incident ON notifications(incident_id);

-- =============================================================================
-- 8. AUDIT LOGS (append-only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Append-only guarantee: no UPDATE/DELETE privileges for app role.
-- (On Supabase the owner runs migrations; app connects as the same role in this
-- project. The constraint is enforced in the application layer: the audit
-- repository only ever INSERTs, and accidental reuse of UPDATE/DELETE queries
-- is prevented by tests.)

-- =============================================================================
-- 9. Deferred / background job bookkeeping (retry + dead letter support)
-- =============================================================================

CREATE TABLE IF NOT EXISTS failed_jobs (
  id            TEXT PRIMARY KEY,
  job_type      TEXT NOT NULL,
  payload       JSONB NOT NULL,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'RETRYING'
                CHECK (status IN ('RETRYING','DEAD','DONE')),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_failed_jobs_retry ON failed_jobs(status, next_attempt_at) WHERE status = 'RETRYING';

-- =============================================================================
-- 10. Schema migrations bookkeeping (managed by runner)
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);