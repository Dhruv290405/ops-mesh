import { describe, expect, it } from 'vitest';
import { calculateSeverity, severityToPriority } from '../severity';
import { ServiceCriticality, EventSeverity, Environment, IncidentSeverity, IncidentPriority } from '../../types';

const base = {
  serviceCriticality: ServiceCriticality.HIGH,
  eventSeverity: EventSeverity.HIGH,
  environment: Environment.PRODUCTION,
  errorFrequency: 1,
  isRepeatedFailure: false
} as const;

describe('calculateSeverity', () => {
  it('is deterministic', () => {
    expect(calculateSeverity({ ...base })).toBe(calculateSeverity({ ...base }));
  });

  it('escalates with service criticality', () => {
    const critical = calculateSeverity({ ...base, serviceCriticality: ServiceCriticality.CRITICAL, eventSeverity: EventSeverity.CRITICAL });
    const low = calculateSeverity({ ...base, serviceCriticality: ServiceCriticality.LOW, eventSeverity: EventSeverity.LOW });
    expect(severityRank(critical)).toBeLessThan(severityRank(low));
  });

  it('escalates with event severity', () => {
    const critical = calculateSeverity({ ...base, eventSeverity: EventSeverity.CRITICAL, serviceCriticality: ServiceCriticality.CRITICAL });
    const medium = calculateSeverity({ ...base, eventSeverity: EventSeverity.MEDIUM, serviceCriticality: ServiceCriticality.CRITICAL });
    expect(severityRank(critical)).toBeLessThan(severityRank(medium));
  });

  it('downgrades non-production environments', () => {
    const prod = calculateSeverity({ ...base, eventSeverity: EventSeverity.CRITICAL, serviceCriticality: ServiceCriticality.CRITICAL });
    const dev = calculateSeverity({ ...base, eventSeverity: EventSeverity.CRITICAL, serviceCriticality: ServiceCriticality.CRITICAL, environment: Environment.DEVELOPMENT });
    expect(severityRank(prod)).toBeLessThan(severityRank(dev));
  });

  it('raises severity with error frequency', () => {
    const rare = calculateSeverity({ ...base, errorFrequency: 1, eventSeverity: EventSeverity.MEDIUM, serviceCriticality: ServiceCriticality.MEDIUM });
    const flood = calculateSeverity({ ...base, errorFrequency: 500, eventSeverity: EventSeverity.MEDIUM, serviceCriticality: ServiceCriticality.MEDIUM });
    expect(severityRank(flood)).toBeLessThan(severityRank(rare));
  });

  it('raises severity on repeated failure', () => {
    const first = calculateSeverity({ ...base, isRepeatedFailure: false, eventSeverity: EventSeverity.MEDIUM, serviceCriticality: ServiceCriticality.MEDIUM });
    const repeat = calculateSeverity({ ...base, isRepeatedFailure: true, eventSeverity: EventSeverity.MEDIUM, serviceCriticality: ServiceCriticality.MEDIUM });
    expect(severityRank(repeat)).toBeLessThanOrEqual(severityRank(first));
  });

  it('respects severity bounds', () => {
    const worst = calculateSeverity({
      serviceCriticality: ServiceCriticality.CRITICAL,
      eventSeverity: EventSeverity.CRITICAL,
      environment: Environment.PRODUCTION,
      errorFrequency: 1000,
      isRepeatedFailure: true
    });
    const best = calculateSeverity({
      serviceCriticality: ServiceCriticality.LOW,
      eventSeverity: EventSeverity.LOW,
      environment: Environment.DEVELOPMENT,
      errorFrequency: 1,
      isRepeatedFailure: false
    });
    expect(worst).toBe(IncidentSeverity.SEV1);
    expect(best).toBe(IncidentSeverity.SEV4);
  });
});

describe('severityToPriority', () => {
  it('maps SEV to priority', () => {
    expect(severityToPriority(IncidentSeverity.SEV1)).toBe(IncidentPriority.P1);
    expect(severityToPriority(IncidentSeverity.SEV2)).toBe(IncidentPriority.P2);
    expect(severityToPriority(IncidentSeverity.SEV3)).toBe(IncidentPriority.P3);
    expect(severityToPriority(IncidentSeverity.SEV4)).toBe(IncidentPriority.P4);
  });
});

function severityRank(s: IncidentSeverity): number {
  const rank: Record<IncidentSeverity, number> = {
    [IncidentSeverity.SEV1]: 1,
    [IncidentSeverity.SEV2]: 2,
    [IncidentSeverity.SEV3]: 3,
    [IncidentSeverity.SEV4]: 4
  };
  return rank[s];
}
