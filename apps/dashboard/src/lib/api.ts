export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : msg);
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, msg);
  }
  const json = await res.json();
  return (json?.data ?? json) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined })
};

// ---- Types (mirror backend DTOs) ----
export interface Incident {
  incidentId: string;
  title: string;
  description: string | null;
  serviceId: string;
  severity: string;
  status: string;
  priority: string;
  assignedEngineerId: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  escalationLevel: number;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentDetail {
  incident: Incident;
  service: { id: string; name: string; criticality: string } | null;
  assignedEngineer: { id: string; name: string; email: string } | null;
  timeline: TimelineEntry[];
  escalations: any[];
  notifications: any[];
  events: any[];
  audit: any[];
}

export interface TimelineEntry {
  id: string;
  incidentId: string;
  type: string;
  actorName?: string;
  message: string;
  metadata?: any;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  environment: string;
  ownerTeamId: string | null;
  criticality: string;
  slaMinutes: number | null;
  status: string;
  openIncidentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceHealth {
  service: Service;
  lastCheck: { status: string; latencyMs?: number; statusCode?: number; error?: string; checkedAt: string } | null;
  recentEvents: any[];
}

export interface EventItem {
  id: string;
  serviceId: string;
  serviceName: string | null;
  eventType: string;
  severity: string;
  message: string;
  environment: string;
  timestamp: string;
  requestId: string | null;
  fingerprint: string;
  incidentId: string | null;
  createdAt: string;
}

export interface DashboardMetrics {
  eventsPerMinute: number;
  eventsLast24h: number;
  totalEvents: number;
  activeIncidents: number;
  openBySeverity: Record<string, number>;
  mttaMinutes: number;
  mttrMinutes: number;
  escalationRate: number;
  serviceAvailability: number;
  servicesByStatus: Record<string, number>;
  resolvedLast24h: number;
  apiLatencyMs: number;
}

export interface QueueStat {
  name: string;
  waiting: number;
  processing: number;
  completed: number;
  failed: number;
  ratePerMin: number;
}

export interface WorkerStat {
  workerId: string;
  workerType: string;
  status: string;
  jobsProcessed: number;
  failedJobs: number;
  currentJob: string | null;
  lastHeartbeat: string;
  startedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  isActive: boolean;
}

export interface HealthComponent {
  name: string;
  status: 'UP' | 'DOWN' | 'DEGRADED';
  latencyMs?: number;
}

// ---- Endpoint helpers ----
export const fetchMe = () => api.get<{ id: string; email: string; role: string; teamId: string | null }>('/api/v1/auth/me');
export const fetchMetrics = () => api.get<DashboardMetrics>('/api/v1/metrics/overview');
export const fetchIncidents = (q: string) => api.get<{ data: Incident[]; total: number; page: number; limit: number }>(`/api/v1/incidents${q}`);
export const fetchIncident = (id: string) => api.get<IncidentDetail>(`/api/v1/incidents/${id}`);
export const fetchServices = (q: string) => api.get<Service[]>(`/api/v1/services${q}`);
export const fetchService = (id: string) => api.get<Service>(`/api/v1/services/${id}`);
export const fetchServiceHealth = (id: string) => api.get<ServiceHealth>(`/api/v1/services/${id}/health`);
export const fetchServiceIncidents = (id: string) => api.get<any[]>(`/api/v1/services/${id}/incidents?limit=20`);
export const fetchEvents = (q: string) => api.get<{ data: EventItem[]; total: number }>(`/api/v1/events${q}`);
export const fetchUsers = () => api.get<User[]>('/api/v1/users?limit=200');
export const fetchQueues = () => api.get<QueueStat[]>('/api/v1/system/queues');
export const fetchWorkers = () => api.get<WorkerStat[]>('/api/v1/system/workers');
export const fetchHealthReady = async () => {
  // /health/ready returns 503 (with a useful body) when a required dependency
  // is down. Tolerate that so the page shows DEGRADED instead of crashing.
  const res = await fetch(`${API_BASE}/health/ready`, { credentials: 'include' });
  const json = await res.json();
  return { status: json.status, components: json.components ?? [] } as {
    status: string;
    components: HealthComponent[];
  };
};
export const fetchHealthDeep = () =>
  api.get<{ components: HealthComponent[]; process: { uptimeSeconds: number; memoryMB: number; nodeVersion: string; pid: number } }>('/health/deep');

export const incidentActions = {
  acknowledge: (id: string, note?: string) => api.post(`/api/v1/incidents/${id}/acknowledge`, { note }),
  setStatus: (id: string, status: string, note?: string, resolutionSummary?: string) =>
    api.patch(`/api/v1/incidents/${id}/status`, { status, note, resolutionSummary }),
  severity: (id: string, severity: string) => api.post(`/api/v1/incidents/${id}/severity`, { severity }),
  assign: (id: string, userId: string, reason?: string) => api.post(`/api/v1/incidents/${id}/assign`, { userId, reason }),
  comment: (id: string, message: string) => api.post(`/api/v1/incidents/${id}/comment`, { message }),
  reopen: (id: string) => api.post(`/api/v1/incidents/${id}/reopen`)
};

export interface ApiKey {
  id: string;
  name: string;
  subject: string;
  purpose: string;
  created_at: string;
  revoked_at: string | null;
}

export const fetchApiKeys = () => api.get<ApiKey[]>('/api/v1/api-keys');
export const createApiKey = (body: { name: string; subject: string; purpose: string }) =>
  api.post<{ key: ApiKey; plaintext: string }>('/api/v1/api-keys', body);
export const revokeApiKey = (id: string) => api.post(`/api/v1/api-keys/${id}/revoke`);
