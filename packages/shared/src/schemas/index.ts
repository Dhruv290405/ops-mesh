import { z } from 'zod';
import {
  EventSeverity,
  Environment,
  ServiceCriticality,
  UserRole,
  IncidentSeverity,
  IncidentStatus,
  NotificationChannel,
  ApiKeyPurpose
} from '../types';

export const emailSchema = z.string().email('Invalid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long');

// ---------------------------------------------------------------- auth
export const registerSchema = z.object({
  email: emailSchema,
  name: z.string().min(2).max(100),
  password: passwordSchema,
  role: z.nativeEnum(UserRole).default(UserRole.ENGINEER),
  teamId: z.string().optional()
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required')
});

// ---------------------------------------------------------------- api keys
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1, 'subject (serviceId) is required'),
  purpose: z.nativeEnum(ApiKeyPurpose).default(ApiKeyPurpose.EVENT_INGEST)
});

// ---------------------------------------------------------------- services
export const createServiceSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Name must be lowercase alphanumeric with dashes'),
  description: z.string().max(500).optional(),
  environment: z.nativeEnum(Environment),
  ownerTeamId: z.string().min(1),
  criticality: z.nativeEnum(ServiceCriticality).default(ServiceCriticality.MEDIUM),
  slaMinutes: z.number().int().positive().optional(),
  healthCheckUrl: z.string().url().optional(),
  healthCheckMethod: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  healthCheckTimeout: z.number().int().min(100).max(30000).default(5000),
  healthCheckInterval: z.number().int().min(5000).max(3600000).default(60000),
  expectedStatus: z.number().int().min(100).max(599).default(200)
});

export const updateServiceSchema = createServiceSchema.partial();

// ---------------------------------------------------------------- events (public ingestion)
export const ingestEventSchema = z.object({
  service: z.string().min(1).max(100),
  eventType: z.string().min(1).max(100),
  severity: z.nativeEnum(EventSeverity),
  message: z.string().min(1).max(2000),
  environment: z.nativeEnum(Environment),
  timestamp: z.string().datetime({ offset: true }).optional(),
  requestId: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional()
});

// ---------------------------------------------------------------- incidents
export const acknowledgeIncidentSchema = z.object({
  note: z.string().max(500).optional()
});

export const updateIncidentStatusSchema = z.object({
  status: z.enum([
    IncidentStatus.ACKNOWLEDGED,
    IncidentStatus.INVESTIGATING,
    IncidentStatus.MITIGATED,
    IncidentStatus.RESOLVED
  ]),
  note: z.string().max(500).optional(),
  resolutionSummary: z.string().max(2000).optional()
});

export const assignIncidentSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().max(500).optional()
});

export const incidentCommentSchema = z.object({
  message: z.string().min(1).max(2000)
});

export const changeSeveritySchema = z.object({
  severity: z.enum([IncidentSeverity.SEV1, IncidentSeverity.SEV2, IncidentSeverity.SEV3, IncidentSeverity.SEV4])
});

// ---------------------------------------------------------------- users / teams
export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().min(2).max(100),
  password: passwordSchema,
  role: z.nativeEnum(UserRole),
  teamId: z.string().optional()
});

export const createTeamSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional()
});

// ---------------------------------------------------------------- on-call
export const createScheduleSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(2).max(100),
  timezone: z.string().min(1).max(64).default('UTC'),
  rotationOrder: z.array(z.string().min(1)).min(1, 'At least one engineer required'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('00:00'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('23:59'),
  escalationTargetId: z.string().optional()
});

// ---------------------------------------------------------------- escalation policies
const escalationStepSchema = z.object({
  level: z.number().int().min(1),
  delayMinutes: z.number().int().min(1).max(1440),
  targetType: z.enum(['USER', 'TEAM', 'SCHEDULE']),
  targetId: z.string().min(1),
  notifyChannels: z.array(z.nativeEnum(NotificationChannel)).min(1, 'At least one channel required')
});

export const createPolicySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  serviceId: z.string().optional(),
  teamId: z.string().optional(),
  steps: z.array(escalationStepSchema).min(1, 'At least one step required')
});

// ---------------------------------------------------------------- pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type PaginationParams = z.infer<typeof paginationSchema>;