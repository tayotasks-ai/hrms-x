import { describe, it, expect } from 'vitest';
import { calculateAnnualPAYE, calculateNigerianPayroll } from './payrollCalc.js';

describe('calculateAnnualPAYE', () => {
  it('is zero for income entirely within the tax-free band', () => {
    expect(calculateAnnualPAYE(0)).toBe(0);
    expect(calculateAnnualPAYE(800_000)).toBe(0);
  });

  it('applies 15% just above the tax-free threshold', () => {
    // 10,000 into the 15% band
    expect(calculateAnnualPAYE(810_000)).toBeCloseTo(1_500, 5);
  });

  it('taxes progressively across multiple bands, not flat on the top rate', () => {
    // 6,474,000 taxable: 2.2m @15% (330,000) + 3,474,000 @18% (625,320)
    expect(calculateAnnualPAYE(6_474_000)).toBeCloseTo(955_320, 2);
  });

  it('handles income spanning every band', () => {
    // 60,000,000 taxable:
    // 2.2m@15% + 9m@18% + 13m@21% + 25m@23% + 10m@25%
    const expected = 2_200_000 * 0.15 + 9_000_000 * 0.18 + 13_000_000 * 0.21 + 25_000_000 * 0.23 + 10_000_000 * 0.25;
    expect(calculateAnnualPAYE(60_000_000)).toBeCloseTo(expected, 2);
  });

  it('treats negative/undefined income as zero rather than throwing', () => {
    expect(calculateAnnualPAYE(-500)).toBe(0);
    expect(calculateAnnualPAYE(undefined)).toBe(0);
  });
});

describe('calculateNigerianPayroll', () => {
  it('computes gross, pension (8%), NHF (2.5% of basic), PAYE, and net pay together', () => {
    const result = calculateNigerianPayroll({ basicSalary: 500_000, allowances: 100_000 });
    expect(result.grossPay).toBe(600_000);
    expect(result.deductions.pension).toBeCloseTo(48_000, 2); // 8% of 600,000
    expect(result.deductions.nhf).toBeCloseTo(12_500, 2);     // 2.5% of 500,000
    // netPay must always reconcile against gross minus total deductions
    expect(result.netPay).toBeCloseTo(result.grossPay - result.deductions.total, 2);
  });

  it('folds otherDeductions (e.g. loan repayments) into the total without affecting PAYE/pension/NHF', () => {
    const withoutOther = calculateNigerianPayroll({ basicSalary: 300_000, allowances: 0 });
    const withOther = calculateNigerianPayroll({ basicSalary: 300_000, allowances: 0, otherDeductions: 15_000 });
    expect(withOther.deductions.paye).toBeCloseTo(withoutOther.deductions.paye, 5);
    expect(withOther.deductions.pension).toBeCloseTo(withoutOther.deductions.pension, 5);
    expect(withOther.deductions.nhf).toBeCloseTo(withoutOther.deductions.nhf, 5);
    expect(withOther.deductions.other).toBeCloseTo(15_000, 2);
    expect(withOther.netPay).toBeCloseTo(withoutOther.netPay - 15_000, 2);
  });

  it('never produces a negative total deduction or a NaN for a zero salary', () => {
    const result = calculateNigerianPayroll({ basicSalary: 0, allowances: 0 });
    expect(result.grossPay).toBe(0);
    expect(result.deductions.total).toBe(0);
    expect(result.netPay).toBe(0);
    expect(Number.isNaN(result.netPay)).toBe(false);
  });

  it('handles missing/undefined fields gracefully instead of throwing', () => {
    expect(() => calculateNigerianPayroll({})).not.toThrow();
    const result = calculateNigerianPayroll({});
    expect(result.grossPay).toBe(0);
  });

  // Per-tenant opt-outs (Tenant.statutoryDeductions) — all default to true
  // (unchanged behavior) when omitted, matching every test above.
  describe('per-tenant deduction toggles', () => {
    it('zeroes PAYE when payeEnabled is false, without touching pension/NHF', () => {
      const on = calculateNigerianPayroll({ basicSalary: 500_000, allowances: 100_000 });
      const off = calculateNigerianPayroll({ basicSalary: 500_000, allowances: 100_000, payeEnabled: false });
      expect(off.deductions.paye).toBe(0);
      expect(off.deductions.pension).toBeCloseTo(on.deductions.pension, 5);
      expect(off.deductions.nhf).toBeCloseTo(on.deductions.nhf, 5);
      expect(off.netPay).toBeCloseTo(on.netPay + on.deductions.paye, 2);
    });

    it('zeroes pension when pensionEnabled is false, and removes it as a PAYE relief', () => {
      const on = calculateNigerianPayroll({ basicSalary: 2_000_000, allowances: 0 });
      const off = calculateNigerianPayroll({ basicSalary: 2_000_000, allowances: 0, pensionEnabled: false });
      expect(off.deductions.pension).toBe(0);
      // Losing the pension relief raises taxable income, so PAYE should rise (or stay equal), never fall.
      expect(off.deductions.paye).toBeGreaterThanOrEqual(on.deductions.paye);
    });

    it('zeroes NHF when nhfEnabled is false, and removes it as a PAYE relief', () => {
      const on = calculateNigerianPayroll({ basicSalary: 2_000_000, allowances: 0 });
      const off = calculateNigerianPayroll({ basicSalary: 2_000_000, allowances: 0, nhfEnabled: false });
      expect(off.deductions.nhf).toBe(0);
      expect(off.deductions.paye).toBeGreaterThanOrEqual(on.deductions.paye);
    });

    it('produces net pay equal to gross pay minus otherDeductions when all three are switched off', () => {
      const result = calculateNigerianPayroll({
        basicSalary: 500_000, allowances: 50_000, otherDeductions: 5_000,
        payeEnabled: false, pensionEnabled: false, nhfEnabled: false,
      });
      expect(result.deductions.paye).toBe(0);
      expect(result.deductions.pension).toBe(0);
      expect(result.deductions.nhf).toBe(0);
      expect(result.deductions.total).toBe(5_000);
      expect(result.netPay).toBe(545_000); // 550,000 gross - 5,000 other
    });
  });
});
