-- OpsMesh demo seed data. Passwords hashed with pgcrypto blowfish ($2a$), which
-- bcryptjs (used by the API) can verify.
-- Demo credentials: admin@opsmesh.io / engineer@opsmesh.io / viewer@opsmesh.io - password: ChangeMe123!

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
END $$;

INSERT INTO teams (id, name, description) VALUES
  ('t_platform', 'Platform', 'Core platform infrastructure team'),
  ('t_payments', 'Payments', 'Payment processing and billing'),
  ('t_orders',    'Orders',    'Order management and fulfillment')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, name, password_hash, role, team_id) VALUES
  ('u_admin',     'admin@opsmesh.io',     'Ada Admin',       crypt('ChangeMe123!', gen_salt('bf', 10)), 'ADMIN',    't_platform'),
  ('u_eng_a',     'alice@opsmesh.io',     'Alice Engineer',  crypt('ChangeMe123!', gen_salt('bf', 10)), 'ENGINEER', 't_payments'),
  ('u_eng_b',     'bob@opsmesh.io',       'Bob Engineer',    crypt('ChangeMe123!', gen_salt('bf', 10)), 'ENGINEER', 't_payments'),
  ('u_eng_c',     'carol@opsmesh.io',     'Carol Engineer',  crypt('ChangeMe123!', gen_salt('bf', 10)), 'ENGINEER', 't_orders'),
  ('u_viewer',    'viewer@opsmesh.io',    'Vera Viewer',     crypt('ChangeMe123!', gen_salt('bf', 10)), 'VIEWER',   NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO services (id, name, description, environment, owner_team_id, criticality, status, sla_minutes,
                      health_check_url, health_check_method, health_check_timeout, health_check_interval, expected_status) VALUES
  ('svc_auth',  'auth-service',        'Authentication, SSO and token issuance',            'production', 't_platform', 'CRITICAL', 'HEALTHY', 15,   NULL, 'GET', 5000, 60000, 200),
  ('svc_pay',   'payment-service',     'Payment orchestration and PSP integrations',        'production', 't_payments', 'CRITICAL', 'HEALTHY', 30,   NULL, 'GET', 5000, 60000, 200),
  ('svc_order', 'order-service',       'Order lifecycle and inventory reservations',        'production', 't_orders',   'HIGH',     'HEALTHY', 60,   NULL, 'GET', 5000, 60000, 200),
  ('svc_search', 'search-service',     'Full-text search and recommendations',              'production', 't_platform', 'MEDIUM',   'HEALTHY', 120,  NULL, 'GET', 5000, 60000, 200),
  ('svc_notif', 'notification-service','Email, push and in-app notifications',              'production', 't_orders',   'MEDIUM',   'HEALTHY', 120,  NULL, 'GET', 5000, 60000, 200)
ON CONFLICT (id) DO NOTHING;

-- Escalation policies: Payments team - 5min -> next engineer, 5min -> team lead
INSERT INTO escalation_policies (id, name, description, service_id, team_id) VALUES
  ('pol_payments', 'Payments Rapid Response', '5min escalation ladder for payment incidents', 'svc_pay', 't_payments'),
  ('pol_platform', 'Platform Standard',       'Standard escalation for platform services',    'svc_auth', 't_platform')
ON CONFLICT (id) DO NOTHING;

INSERT INTO escalation_steps (id, policy_id, level, delay_minutes, target_type, target_id, notify_channels) VALUES
  ('est_p1', 'pol_payments', 1, 5,  'USER',     'u_eng_a',  ARRAY['EMAIL','WEBHOOK','SLACK']),
  ('est_p2', 'pol_payments', 2, 5,  'USER',     'u_eng_b',  ARRAY['EMAIL','WEBHOOK']),
  ('est_p3', 'pol_payments', 3, 5,  'USER',     'u_admin',  ARRAY['EMAIL']),
  ('est_pl1', 'pol_platform', 1, 5, 'SCHEDULE', 'sch_plat', ARRAY['EMAIL','WEBHOOK']),
  ('est_pl2', 'pol_platform', 2, 10, 'TEAM',    't_platform', ARRAY['EMAIL'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO on_call_schedules (id, team_id, name, timezone, rotation_order, start_time, end_time, escalation_target_id) VALUES
  ('sch_plat', 't_platform', 'Platform Primary', 'UTC', ARRAY['u_eng_c','u_admin'], '00:00', '23:59', NULL),
  ('sch_pay',  't_payments', 'Payments Primary', 'UTC', ARRAY['u_eng_a','u_eng_b'], '00:00', '23:59', NULL)
ON CONFLICT (id) DO NOTHING;