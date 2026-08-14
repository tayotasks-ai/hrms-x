// Nigerian statutory payroll calculation.
//
// Basis: Nigeria Tax Act 2025 (signed 26 June 2025, effective 1 January 2026),
// which replaced the old PITA / Consolidated Relief Allowance regime.
//
// PAYE — annual bands, applied progressively:
//   ₦0          – ₦800,000     : 0%
//   ₦800,000    – ₦3,000,000   : 15%
//   ₦3,000,000  – ₦12,000,000  : 18%
//   ₦12,000,000 – ₦25,000,000  : 21%
//   ₦25,000,000 – ₦50,000,000  : 23%
//   above ₦50,000,000          : 25%
// The first ₦800,000 of annual taxable income is tax-free; there is no separate
// Consolidated Relief Allowance to apply on top of that under the new Act.
//
// Pension — 8% employee contribution, statutorily on Basic + Housing + Transport.
// This system doesn't track Housing/Transport as separate salary components, so
// we approximate the pensionable base as (basicSalary + allowances). Tenants with
// a different housing/transport split should treat the computed figure as a
// starting point, not a final regulatory filing number.
//
// NHF — 2.5% of Basic salary only.
//
// Both pension and NHF are treated as pre-tax reliefs (deducted before PAYE is
// calculated), which is standard practice.

const PAYE_BANDS = [
  { upTo: 800_000, rate: 0 },
  { upTo: 3_000_000, rate: 0.15 },
  { upTo: 12_000_000, rate: 0.18 },
  { upTo: 25_000_000, rate: 0.21 },
  { upTo: 50_000_000, rate: 0.23 },
  { upTo: Infinity, rate: 0.25 },
];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Progressive tax on a given annual taxable income, using the bands above.
export const calculateAnnualPAYE = (annualTaxableIncome) => {
  let tax = 0;
  let prevCap = 0;
  const income = Math.max(0, annualTaxableIncome || 0);

  for (const band of PAYE_BANDS) {
    if (income <= prevCap) break;
    const taxableInBand = Math.min(income, band.upTo) - prevCap;
    tax += taxableInBand * band.rate;
    prevCap = band.upTo;
  }
  return tax;
};

// Computes a full statutory breakdown for one monthly payslip.
// otherDeductions covers anything outside PAYE/pension/NHF (e.g. loan repayment,
// union dues) that HR enters manually.
export const calculateNigerianPayroll = ({ basicSalary = 0, allowances = 0, otherDeductions = 0 }) => {
  const basic = Number(basicSalary) || 0;
  const allow = Number(allowances) || 0;
  const other = Number(otherDeductions) || 0;

  const grossPay = basic + allow;
  const pensionablePay = grossPay; // approximation — see header comment
  const pension = round2(pensionablePay * 0.08);
  const nhf = round2(basic * 0.025);

  const monthlyReliefs = pension + nhf;
  const annualTaxableIncome = Math.max(0, (grossPay - monthlyReliefs) * 12);
  const paye = round2(calculateAnnualPAYE(annualTaxableIncome) / 12);

  const total = round2(paye + pension + nhf + other);
  const netPay = round2(grossPay - total);

  return {
    grossPay: round2(grossPay),
    deductions: { paye, pension, nhf, other: round2(other), total },
    netPay,
  };
};
