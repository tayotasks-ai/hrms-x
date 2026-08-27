import { describe, it, expect } from 'vitest';
import { computeOnboardingProgress } from './platformController.js';

// Pure decision logic behind the root/platform view's "help them onboard"
// signal — see listTenants/getTenantDetail, which call this with real
// tenant/employee/wallet data. Kept separate so it's testable without
// mocking Mongo, matching the pattern already used for computeRemainingSeats
// in employeeController.js.
describe('computeOnboardingProgress', () => {
  it('a brand new tenant with nothing set up is at 0%', () => {
    const result = computeOnboardingProgress({ employeeCount: 0, walletBalance: 0, hasRunPayroll: false });
    expect(result.completed).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.steps).toEqual({ employees_added: false, wallet_funded: false, payroll_run: false });
  });

  it('adding employees alone moves it to 1/3', () => {
    const result = computeOnboardingProgress({ employeeCount: 3, walletBalance: 0, hasRunPayroll: false });
    expect(result.completed).toBe(1);
    expect(result.steps.employees_added).toBe(true);
    expect(result.percent).toBe(33);
  });

  it('funding the wallet alone counts independently of headcount', () => {
    const result = computeOnboardingProgress({ employeeCount: 0, walletBalance: 50000, hasRunPayroll: false });
    expect(result.steps.wallet_funded).toBe(true);
    expect(result.completed).toBe(1);
  });

  it('a fully onboarded tenant is 100%', () => {
    const result = computeOnboardingProgress({ employeeCount: 5, walletBalance: 20000, hasRunPayroll: true });
    expect(result.completed).toBe(3);
    expect(result.percent).toBe(100);
    expect(result.steps).toEqual({ employees_added: true, wallet_funded: true, payroll_run: true });
  });

  it('handles missing/undefined input gracefully (defensive default)', () => {
    const result = computeOnboardingProgress();
    expect(result.completed).toBe(0);
    expect(result.percent).toBe(0);
  });

  it('a zero or negative wallet balance does not count as funded', () => {
    expect(computeOnboardingProgress({ walletBalance: 0 }).steps.wallet_funded).toBe(false);
    expect(computeOnboardingProgress({ walletBalance: -100 }).steps.wallet_funded).toBe(false);
  });
});
