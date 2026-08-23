import { IncidentStatus } from '../types';

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  [IncidentStatus.OPEN]: [
    IncidentStatus.ACKNOWLEDGED,
    IncidentStatus.ESCALATED,
    IncidentStatus.RESOLVED
  ],
  [IncidentStatus.ACKNOWLEDGED]: [
    IncidentStatus.INVESTIGATING,
    IncidentStatus.ESCALATED,
    IncidentStatus.RESOLVED
  ],
  [IncidentStatus.INVESTIGATING]: [
    IncidentStatus.MITIGATED,
    IncidentStatus.ESCALATED,
    IncidentStatus.ACKNOWLEDGED,
    IncidentStatus.RESOLVED
  ],
  [IncidentStatus.MITIGATED]: [
    IncidentStatus.RESOLVED,
    IncidentStatus.INVESTIGATING,
    IncidentStatus.ESCALATED
  ],
  [IncidentStatus.RESOLVED]: [],
  [IncidentStatus.ESCALATED]: [
    IncidentStatus.ACKNOWLEDGED,
    IncidentStatus.INVESTIGATING,
    IncidentStatus.RESOLVED
  ]
};

export function isValidTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  const allowed = INCIDENT_TRANSITIONS[from];
  return allowed.includes(to);
}

export class IncidentStateMachine {
  private currentStatus: IncidentStatus;
  
  constructor(initialStatus: IncidentStatus = IncidentStatus.OPEN) {
    this.currentStatus = initialStatus;
  }
  
  getStatus(): IncidentStatus {
    return this.currentStatus;
  }
  
  canTransition(to: IncidentStatus): boolean {
    return isValidTransition(this.currentStatus, to);
  }
  
  transition(to: IncidentStatus): boolean {
    if (!this.canTransition(to)) {
      return false;
    }
    this.currentStatus = to;
    return true;
  }
  
  forceTransition(to: IncidentStatus): void {
    this.currentStatus = to;
  }
  
  static getValidTransitions(status: IncidentStatus): IncidentStatus[] {
    return INCIDENT_TRANSITIONS[status] || [];
  }
  
  static isTerminal(status: IncidentStatus): boolean {
    return status === IncidentStatus.RESOLVED;
  }
}

export function validateStatusTransition(
  currentStatus: IncidentStatus,
  newStatus: IncidentStatus
): { valid: boolean; error?: string } {
  if (!isValidTransition(currentStatus, newStatus)) {
    return {
      valid: false,
      error: `Invalid status transition from ${currentStatus} to ${newStatus}. Allowed: ${INCIDENT_TRANSITIONS[currentStatus].join(', ')}`
    };
  }
  return { valid: true };
}