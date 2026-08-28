import { describe, it, expect } from 'vitest';
import { computeRemainingSeats } from './employeeController.js';

// Pure decision logic behind the freemium employee cap — see
// createEmployee/bulkCreateEmployees, which call the DB-touching
// getRemainingSeats wrapper around this. Getting this wrong either blocks a
// paying customer from hiring, or lets a Free tenant grow unlimited for free
// — worth pinning down precisely.
describe('computeRemainingSeats', () => {
  it('a brand new Free tenant (0 employees) has the full limit available', () => {
    expect(computeRemainingSeats('Free', 5, 0)).toBe(5);
  });

  it('counts down as headcount approaches the limit', () => {
    expect(computeRemainingSeats('Free', 5, 3)).toBe(2);
    expect(computeRemainingSeats('Free', 5, 4)).toBe(1);
  });

  it('returns 0 exactly at the limit (blocks the 6th employee)', () => {
    expect(computeRemainingSeats('Free', 5, 5)).toBe(0);
  });

  it('never goes negative if headcount somehow exceeds the limit', () => {
    expect(computeRemainingSeats('Free', 5, 9)).toBe(0);
  });

  it('Paid tenants have no cap regardless of headcount', () => {
    expect(computeRemainingSeats('Paid', 5, 5)).toBe(Infinity);
    expect(computeRemainingSeats('Paid', 5, 500)).toBe(Infinity);
  });

  it('defaults the limit to 5 if the tenant document has none set', () => {
    expect(computeRemainingSeats('Free', undefined, 4)).toBe(1);
    expect(computeRemainingSeats('Free', null, 5)).toBe(0);
  });

  it('respects a non-default limit if one is configured', () => {
    expect(computeRemainingSeats('Free', 10, 7)).toBe(3);
  });

  it('a Free tenant flagged isTestAccount is uncapped, same as Paid', () => {
    expect(computeRemainingSeats('Free', 5, 5, true)).toBe(Infinity);
    expect(computeRemainingSeats('Free', 5, 500, true)).toBe(Infinity);
  });

  it('isTestAccount defaults to false and does not affect normal Free tenants', () => {
    expect(computeRemainingSeats('Free', 5, 5)).toBe(0);
    expect(computeRemainingSeats('Free', 5, 5, false)).toBe(0);
  });
});
