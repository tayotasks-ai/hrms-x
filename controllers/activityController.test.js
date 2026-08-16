import { describe, it, expect } from 'vitest';
import { computePingIncrement } from './activityController.js';

describe('computePingIncrement', () => {
  it('counts one full heartbeat interval when there is no prior ping today', () => {
    expect(computePingIncrement(null, new Date(), 5)).toBe(5);
  });

  it('counts elapsed minutes when they are less than one heartbeat interval', () => {
    const now = new Date(2026, 7, 16, 10, 5, 0);
    const lastPingAt = new Date(2026, 7, 16, 10, 2, 0); // 3 minutes ago
    expect(computePingIncrement(lastPingAt, now, 5)).toBe(3);
  });

  it('caps the increment at one heartbeat interval even if much more time elapsed', () => {
    const now = new Date(2026, 7, 16, 14, 0, 0);
    const lastPingAt = new Date(2026, 7, 16, 9, 0, 0); // 5 hours ago (e.g. laptop slept, tab resumed)
    expect(computePingIncrement(lastPingAt, now, 5)).toBe(5);
  });

  it('returns 0 for a ping that is not actually later than the last one (clock skew / duplicate)', () => {
    const now = new Date(2026, 7, 16, 10, 0, 0);
    const lastPingAt = new Date(2026, 7, 16, 10, 1, 0); // "later" than now
    expect(computePingIncrement(lastPingAt, now, 5)).toBe(0);
  });
});
