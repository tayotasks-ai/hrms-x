import { describe, it, expect } from 'vitest';
import { computeRetentionCutoff } from './retentionController.js';

describe('computeRetentionCutoff', () => {
  it('subtracts the given number of years from now', () => {
    const now = new Date(2026, 7, 14); // 14 Aug 2026
    const cutoff = computeRetentionCutoff(6, now);
    expect(cutoff.getFullYear()).toBe(2020);
    expect(cutoff.getMonth()).toBe(7);
    expect(cutoff.getDate()).toBe(14);
  });

  it('an employee offboarded before the cutoff is past the retention window', () => {
    const now = new Date(2026, 7, 14);
    const cutoff = computeRetentionCutoff(6, now);
    const offboardedAt = new Date(2019, 0, 1); // Jan 2019 — well before cutoff
    expect(offboardedAt.getTime()).toBeLessThan(cutoff.getTime());
  });

  it('an employee offboarded after the cutoff is still within the retention window', () => {
    const now = new Date(2026, 7, 14);
    const cutoff = computeRetentionCutoff(6, now);
    const offboardedAt = new Date(2023, 0, 1); // Jan 2023 — after cutoff
    expect(offboardedAt.getTime()).toBeGreaterThan(cutoff.getTime());
  });

  it('defaults to the current date when now is not provided', () => {
    const cutoff = computeRetentionCutoff(1);
    const expected = new Date();
    expected.setFullYear(expected.getFullYear() - 1);
    // Allow a small delta for test execution time.
    expect(Math.abs(cutoff.getTime() - expected.getTime())).toBeLessThan(5000);
  });
});
