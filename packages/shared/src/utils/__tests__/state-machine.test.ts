import { describe, expect, it } from 'vitest';
import { IncidentStateMachine, isValidTransition, INCIDENT_TRANSITIONS, validateStatusTransition } from '../state-machine';
import { IncidentStatus } from '../../types';

describe('IncidentStateMachine', () => {
  it('starts OPEN', () => {
    const sm = new IncidentStateMachine();
    expect(sm.getStatus()).toBe(IncidentStatus.OPEN);
  });

  it('accepts valid transitions', () => {
    const sm = new IncidentStateMachine();
    expect(sm.transition(IncidentStatus.ACKNOWLEDGED)).toBe(true);
    expect(sm.getStatus()).toBe(IncidentStatus.ACKNOWLEDGED);
    expect(sm.transition(IncidentStatus.INVESTIGATING)).toBe(true);
    expect(sm.transition(IncidentStatus.MITIGATED)).toBe(true);
    expect(sm.transition(IncidentStatus.RESOLVED)).toBe(true);
  });

  it('accepts OPEN -> ESCALATED path', () => {
    const sm = new IncidentStateMachine();
    expect(sm.transition(IncidentStatus.ESCALATED)).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const sm = new IncidentStateMachine();
    // OPEN cannot jump to MITIGATED (requires acked/investigating first)
    expect(sm.transition(IncidentStatus.MITIGATED)).toBe(false);
    expect(sm.getStatus()).toBe(IncidentStatus.OPEN);
    // OPEN -> ACKNOWLEDGED then ACKNOWLEDGED -> MITIGATED is invalid
    sm.transition(IncidentStatus.ACKNOWLEDGED);
    expect(sm.transition(IncidentStatus.MITIGATED)).toBe(false);
  });

  it('RESOLVED is terminal', () => {
    const sm = new IncidentStateMachine();
    sm.transition(IncidentStatus.RESOLVED);
    expect(sm.transition(IncidentStatus.OPEN)).toBe(false);
    expect(IncidentStateMachine.isTerminal(IncidentStatus.RESOLVED)).toBe(true);
  });

  it('ESCALATED can be recovered from', () => {
    const sm = new IncidentStateMachine();
    sm.transition(IncidentStatus.ESCALATED);
    expect(sm.transition(IncidentStatus.ACKNOWLEDGED)).toBe(true);
  });
});

describe('validateStatusTransition', () => {
  it('returns error for invalid transition with allowed list', () => {
    const res = validateStatusTransition(IncidentStatus.OPEN, IncidentStatus.MITIGATED);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Invalid status transition');
    expect(res.error).toContain('ACKNOWLEDGED');
  });

  it('passes for valid transition', () => {
    const res = validateStatusTransition(IncidentStatus.MITIGATED, IncidentStatus.RESOLVED);
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

describe('transition table completeness', () => {
  it('defines transitions for every status', () => {
    for (const s of Object.values(IncidentStatus)) {
      expect(INCIDENT_TRANSITIONS[s]).toBeDefined();
    }
  });

it('is consistent with isValidTransition', () => {
    for (const [from, tos] of Object.entries(INCIDENT_TRANSITIONS) as [IncidentStatus, IncidentStatus[]][]) {
      for (const to of tos) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    }
  });
});
