import { 
  ServiceCriticality, 
  EventSeverity, 
  IncidentSeverity, 
  IncidentPriority,
  Environment 
} from '../types';

export interface SeverityCalculationInput {
  serviceCriticality: ServiceCriticality;
  eventSeverity: EventSeverity;
  environment: Environment;
  errorFrequency: number;
  affectedUsers?: number;
  isRepeatedFailure: boolean;
}

const CRITICALITY_BUMP: Record<ServiceCriticality, number> = {
  [ServiceCriticality.LOW]: -0.5,
  [ServiceCriticality.MEDIUM]: 0,
  [ServiceCriticality.HIGH]: 0.5,
  [ServiceCriticality.CRITICAL]: 1
};

const EVENT_SEVERITY_WEIGHTS: Record<EventSeverity, number> = {
  [EventSeverity.LOW]: 1,
  [EventSeverity.MEDIUM]: 2,
  [EventSeverity.HIGH]: 3,
  [EventSeverity.CRITICAL]: 4
};

const ENVIRONMENT_PENALTY: Record<Environment, number> = {
  [Environment.DEVELOPMENT]: -1.5,
  [Environment.STAGING]: -0.5,
  [Environment.PRODUCTION]: 0
};

/**
 * Incident severity is driven primarily by the raw event severity, modulated
 * by service criticality and environment, with small bumps for frequency and
 * repeated failure. Scores are clamped to [1,4]; CRITICAL events in production
 * map to SEV-1, LOW events in development to SEV-4.
 */
export function calculateSeverity(input: SeverityCalculationInput): IncidentSeverity {
  let score =
    EVENT_SEVERITY_WEIGHTS[input.eventSeverity] +
    CRITICALITY_BUMP[input.serviceCriticality] +
    ENVIRONMENT_PENALTY[input.environment];

  if (input.errorFrequency > 100) score += 0.75;
  else if (input.errorFrequency > 50) score += 0.5;
  else if (input.errorFrequency > 10) score += 0.25;
  else if (input.errorFrequency > 5) score += 0.25;

  if (input.affectedUsers && input.affectedUsers > 1000) score += 0.5;
  else if (input.affectedUsers && input.affectedUsers > 100) score += 0.25;

  if (input.isRepeatedFailure) score += 0.5;

  score = Math.min(4, Math.max(1, score));

  if (score >= 3.75) return IncidentSeverity.SEV1;
  if (score >= 2.75) return IncidentSeverity.SEV2;
  if (score >= 1.5) return IncidentSeverity.SEV3;
  return IncidentSeverity.SEV4;
}

export function severityToPriority(severity: IncidentSeverity): IncidentPriority {
  switch (severity) {
    case IncidentSeverity.SEV1: return IncidentPriority.P1;
    case IncidentSeverity.SEV2: return IncidentPriority.P2;
    case IncidentSeverity.SEV3: return IncidentPriority.P3;
    case IncidentSeverity.SEV4: return IncidentPriority.P4;
  }
}

export function getSeverityDescription(severity: IncidentSeverity): string {
  switch (severity) {
    case IncidentSeverity.SEV1: return 'Critical impact - immediate response required';
    case IncidentSeverity.SEV2: return 'Major impact - urgent response required';
    case IncidentSeverity.SEV3: return 'Minor impact - response required within hours';
    case IncidentSeverity.SEV4: return 'Low impact - response required within days';
  }
}