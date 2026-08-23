export enum ServiceStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  DOWN = 'DOWN',
  UNKNOWN = 'UNKNOWN',
  MAINTENANCE = 'MAINTENANCE'
}

export enum ServiceCriticality {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum Environment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production'
}

export enum EventSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum IncidentSeverity {
  SEV1 = 'SEV-1',
  SEV2 = 'SEV-2',
  SEV3 = 'SEV-3',
  SEV4 = 'SEV-4'
}

export enum IncidentStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  INVESTIGATING = 'INVESTIGATING',
  MITIGATED = 'MITIGATED',
  RESOLVED = 'RESOLVED',
  ESCALATED = 'ESCALATED'
}

export enum IncidentPriority {
  P1 = 'P1',
  P2 = 'P2',
  P3 = 'P3',
  P4 = 'P4'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  ENGINEER = 'ENGINEER',
  VIEWER = 'VIEWER'
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  WEBHOOK = 'WEBHOOK',
  SLACK = 'SLACK'
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING'
}

export enum EscalationStatus {
  PENDING = 'PENDING',
  TRIGGERED = 'TRIGGERED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED'
}

export enum HealthCheckStatus {
  PASS = 'PASS',
  FAIL = 'FAIL',
  WARN = 'WARN'
}

export enum ApiKeyPurpose {
  EVENT_INGEST = 'event_ingest',
  ADMIN = 'admin'
}

export interface ApiKeyAuth {
  subject: string;
  purpose: ApiKeyPurpose;
  keyId?: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  environment: Environment;
  ownerTeamId: string;
  healthCheckUrl?: string;
  healthCheckMethod?: string;
  healthCheckTimeout?: number;
  healthCheckInterval?: number;
  expectedStatus?: number;
  criticality: ServiceCriticality;
  sla?: number;
  status: ServiceStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface CreateServiceInput {
  name: string;
  description?: string;
  environment: Environment;
  ownerTeamId: string;
  healthCheckUrl?: string;
  healthCheckMethod?: string;
  healthCheckTimeout?: number;
  healthCheckInterval?: number;
  expectedStatus?: number;
  criticality: ServiceCriticality;
  slaMinutes?: number;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  ownerTeamId?: string;
  healthCheckUrl?: string;
  healthCheckMethod?: string;
  healthCheckTimeout?: number;
  healthCheckInterval?: number;
  expectedStatus?: number;
  criticality?: ServiceCriticality;
  slaMinutes?: number;
  status?: ServiceStatus;
}

export interface Event {
  id: string;
  serviceId: string;
  eventType: string;
  severity: EventSeverity;
  message: string;
  environment: Environment;
  timestamp: Date;
  requestId?: string;
  fingerprint: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface IngestEventInput {
  service: string;
  eventType: string;
  severity: EventSeverity;
  message: string;
  environment: Environment;
  timestamp: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  serviceId: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  priority: IncidentPriority;
  assignedEngineerId?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  escalationLevel: number;
  eventCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIncidentInput {
  title: string;
  description: string;
  serviceId: string;
  severity: IncidentSeverity;
  priority: IncidentPriority;
  assignedEngineerId?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  priority?: IncidentPriority;
  assignedEngineerId?: string;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  eventId: string;
  createdAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  teamId?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  teamId?: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTeamInput {
  name: string;
  description: string;
}

export interface OnCallSchedule {
  id: string;
  teamId: string;
  name: string;
  timezone: string;
  rotationOrder: string[];
  startTime: string;
  endTime: string;
  escalationTargetId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOnCallScheduleInput {
  teamId: string;
  name: string;
  timezone: string;
  rotationOrder: string[];
  startTime: string;
  endTime: string;
  escalationTargetId?: string;
}

export interface EscalationPolicy {
  id: string;
  name: string;
  description: string;
  serviceId?: string;
  teamId?: string;
  steps: EscalationStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EscalationStep {
  id: string;
  policyId: string;
  level: number;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetId: string;
  notifyChannels: NotificationChannel[];
}

export interface CreateEscalationPolicyInput {
  name: string;
  description: string;
  serviceId?: string;
  teamId?: string;
  steps: Omit<EscalationStep, 'id' | 'policyId'>[];
}

export interface Notification {
  id: string;
  incidentId: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  status: NotificationStatus;
  attempts: number;
  lastAttemptAt?: Date;
  sentAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface HealthCheckResult {
  serviceId: string;
  status: HealthCheckStatus;
  latencyMs?: number;
  statusCode?: number;
  error?: string;
  checkedAt: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  teamId?: string;
  purpose?: 'user' | 'api';
  iat: number;
  exp: number;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: string;
}

export interface DashboardMetrics {
  eventsPerMinute: number;
  activeIncidents: number;
  mtta: number;
  mttr: number;
  escalationRate: number;
  serviceAvailability: number;
}

export interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  type: 'CREATED' | 'ACKNOWLEDGED' | 'STATUS_CHANGED' | 'ESCALATED' | 'ASSIGNED' | 'RESOLVED' | 'COMMENT' | 'EVENT_ADDED';
  actorId?: string;
  actorName?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}