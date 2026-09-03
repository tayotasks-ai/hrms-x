// Creates (or resets) a sandbox "demo org" tenant that's safe to hand out to
// anyone for a self-guided tour — a prospective client, a friend, whoever.
// Every code path that would normally call Paystack for this tenant is
// short-circuited to a synthetic success (see isDemoAccount checks in
// payslipPaymentController.js, walletController.js, and bankController.js),
// so nobody clicking around in here can touch the platform's real Paystack
// account, move real money, or need real bank details.
//
// Safe to re-run: it wipes and rebuilds this ONE tenant's data (matched by
// its fixed slug) every time, so if a demo gets left in a messy state, just
// run this again to reset it to a clean starting point.
//
// Usage (from backend/):
//   node scripts/seedDemoOrg.js
//   node scripts/seedDemoOrg.js --email you@example.com --password SomePassword123!
//
// Both flags are optional — omit either (or both) to use the defaults below.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';

import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import Payslip from '../models/Payslip.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { calculateNigerianPayroll } from '../utils/payrollCalc.js';
import { encryptPii } from '../utils/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEMO_SLUG = 'workdesk-demo';
const DEMO_ORG_NAME = 'WorkDesk Demo';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const adminEmail = flag('email', 'demo.admin@example.com').toLowerCase().trim();
const adminPassword = flag('password', 'WorkDeskDemo2026!');

const currentPeriod = () => new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

const DEPARTMENTS = ['Engineering', 'Sales', 'Operations'];

// A mix: some already paid (so Recent Activity / payslip history has
// something in it), some still Unpaid (so a visitor has something real to
// click "Pay Now" on and watch the mocked instant-success flow).
const EMPLOYEES = [
  { name: 'Ada Okafor', role: 'Software Engineer', department: 'Engineering', salary: 650000, gender: 'Female', alreadyPaid: true },
  { name: 'Bayo Adeyemi', role: 'Sales Executive', department: 'Sales', salary: 420000, gender: 'Male', alreadyPaid: true },
  { name: 'Chiamaka Eze', role: 'Operations Lead', department: 'Operations', salary: 550000, gender: 'Female', alreadyPaid: false },
  { name: 'David Musa', role: 'Frontend Engineer', department: 'Engineering', salary: 480000, gender: 'Male', alreadyPaid: false },
  { name: 'Funke Bello', role: 'Account Manager', department: 'Sales', salary: 400000, gender: 'Female', alreadyPaid: false },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/antigravity_hrms');

  // ── Wipe any previous demo run for this slug ──────────────────────────
  const existing = await Tenant.findOne({ slug: DEMO_SLUG });
  if (existing) {
    await Promise.all([
      User.deleteMany({ tenantId: existing._id }),
      Employee.deleteMany({ tenantId: existing._id }),
      Department.deleteMany({ tenantId: existing._id }),
      Payslip.deleteMany({ tenantId: existing._id }),
      WalletTransaction.deleteMany({ tenantId: existing._id }),
      Tenant.deleteOne({ _id: existing._id }),
    ]);
    console.log(`Cleared previous demo org (${existing._id}).`);
  }

  // ── Tenant ──────────────────────────────────────────────────────────────
  const tenant = await Tenant.create({
    name: DEMO_ORG_NAME,
    slug: DEMO_SLUG,
    isTestAccount: true, // no fees on top of the (mocked) transfers, same as any real test account
    isDemoAccount: true, // the actual switch that mocks every Paystack call for this tenant
    plan: { tier: 'Paid', freeEmployeeLimit: 5 }, // Paid so the seat cap never gets in a demo visitor's way
    wallet: {
      balance: 500000, // pre-funded — no need to demo the real bank-transfer funding step
      dedicatedAccount: {
        accountNumber: '0000000000',
        accountName: `${DEMO_ORG_NAME.toUpperCase()} (SANDBOX)`,
        bankName: 'Demo Bank (not real)',
        bankId: 0,
        active: true,
      },
      requireDualApproval: false,
    },
    payrollSchedule: { dayOfMonth: 25, useLastDayOfMonth: false, active: true },
  });

  // ── HR Admin ────────────────────────────────────────────────────────────
  const admin = await User.create({
    name: 'Demo Admin',
    email: adminEmail,
    password: adminPassword,
    role: 'HR_Admin',
    tenantId: tenant._id,
  });

  // ── Departments ─────────────────────────────────────────────────────────
  const deptByName = new Map();
  for (const name of DEPARTMENTS) {
    const dept = await Department.create({ tenantId: tenant._id, name });
    deptByName.set(name, dept._id);
  }

  // ── Employees (bank details pre-verified with fabricated data — never
  //    goes near Paystack, see bankController.js isDemoAccount handling) ──
  const period = currentPeriod();
  let seq = 1;
  for (const e of EMPLOYEES) {
    const emp = await Employee.create({
      name: e.name,
      email: `${e.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      role: e.role,
      departmentId: deptByName.get(e.department),
      salary: e.salary,
      status: 'Active',
      joinDate: new Date(new Date().getFullYear() - 1, 0, 15),
      birthDate: new Date(1992, 3, 10),
      gender: e.gender,
      tenantId: tenant._id,
      password: 'DemoEmployee123!', // employees aren't part of the credentials handed out, but need SOME password
      bankDetails: {
        bankName: 'Demo Bank (not real)',
        bankCode: '000',
        accountNumber: encryptPii(`00000000${seq}`),
        accountName: e.name.toUpperCase(),
        verified: true,
        verifiedAt: new Date(),
        paystackRecipientCode: `RCP_demo_seed_${seq}`,
      },
    });

    const calc = calculateNigerianPayroll({ basicSalary: e.salary, allowances: 0, otherDeductions: 0 });
    const reference = `demo_seed_${crypto.randomBytes(4).toString('hex')}`;
    const payslip = await Payslip.create({
      employeeId: emp._id,
      tenantId: tenant._id,
      period,
      basicSalary: e.salary,
      allowances: 0,
      grossPay: calc.grossPay,
      deductions: calc.deductions,
      netPay: calc.netPay,
      status: 'Paid', // payslip itself is finalized either way
      payment: e.alreadyPaid
        ? { status: 'Paid', reference, paidAt: new Date() }
        : { status: 'Unpaid' },
    });

    if (e.alreadyPaid) {
      await WalletTransaction.create({
        tenantId: tenant._id,
        type: 'Payroll_Debit',
        amount: calc.netPay,
        balanceAfter: tenant.wallet.balance, // approximate — fine for a demo ledger, not reconciled against real debits
        reference,
        status: 'Success',
        relatedPayslip: payslip._id,
        meta: { netPay: calc.netPay, paystackFee: 0, stampDuty: 0, markup: 0, total: calc.netPay, demo: true },
      });
    }

    seq += 1;
  }

  // A funding entry so the Wallet tab's Recent Activity isn't empty on first look.
  await WalletTransaction.create({
    tenantId: tenant._id,
    type: 'Funding',
    amount: 500000,
    balanceAfter: 500000,
    reference: `demo_seed_funding_${crypto.randomBytes(4).toString('hex')}`,
    status: 'Success',
  });

  console.log('\nDemo org ready.\n');
  console.log(`  Organisation: ${DEMO_ORG_NAME} (slug: ${DEMO_SLUG})`);
  console.log(`  Login URL:    ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`  Email:        ${admin.email}`);
  console.log(`  Password:     ${adminPassword}`);
  console.log(`\n  ${EMPLOYEES.length} employees seeded (${EMPLOYEES.filter(e => e.alreadyPaid).length} already paid, ${EMPLOYEES.filter(e => !e.alreadyPaid).length} ready to pay) for period "${period}".`);
  console.log('  Wallet balance: ₦500,000 (mocked — no real Paystack account involved).');
  console.log('\nRe-run this script any time to reset the demo org back to this state.\n');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Failed to seed demo org:', err.message);
  process.exit(1);
});
