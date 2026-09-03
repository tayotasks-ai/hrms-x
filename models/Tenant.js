import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  // Freemium plan. Every tenant starts Free, capped at freeEmployeeLimit
  // non-offboarded employees — see employeeController.js's assertSeatAvailable,
  // called from both createEmployee and bulkCreateEmployees. Paid tier is
  // ₦1,500/employee/month (see PLAN_PRICE_PER_EMPLOYEE in
  // controllers/tenantController.js — platform-wide, not stored per-tenant).
  // Upgrading is still a self-serve, no-payment stub (upgradeTenantPlan) —
  // the price is now real, but there's no recurring-billing mechanism yet.
  // Wire in real billing (Paystack Subscriptions or similar) before this is
  // customer-facing for revenue; right now clicking "Upgrade" just lifts the
  // cap without collecting payment.
  plan: {
    tier: { type: String, enum: ['Free', 'Paid'], default: 'Free' },
    freeEmployeeLimit: { type: Number, default: 5, min: 1 },
    upgradedAt: { type: Date },
  },
  // Platform-admin-only override for orgs helping us test the product.
  // Exempts the tenant from the free-tier seat cap (treated like Paid in
  // computeRemainingSeats, employeeController.js) regardless of plan.tier,
  // so testers aren't blocked by billing while trying things out. Settable
  // only from the root/platform dashboard (platformController.js) — no
  // tenant-facing UI exposes this, by design.
  isTestAccount: { type: Boolean, default: false },
  // A sandbox org meant to be handed out freely (sales demos, "try before you
  // sign up" links) so it needs to survive anyone clicking every button
  // without ever touching the real Paystack platform account. Every code
  // path that would normally call Paystack for THIS tenant — payroll
  // transfers, wallet balance/settlement checks, bank account verification —
  // is short-circuited to a synthetic success instead. See
  // scripts/seedDemoOrg.js (creates/refreshes the org) and the isDemoAccount
  // checks in payslipPaymentController.js, walletController.js, and
  // bankController.js. Platform-admin-only, same as isTestAccount.
  isDemoAccount: { type: Boolean, default: false },
  // Payroll wallet — replaces the old per-tenant "bring your own Paystack
  // key" model. Every tenant funds THIS wallet (by transferring into their
  // own dedicated virtual account) and every payroll transfer is disbursed
  // from the PLATFORM's own Paystack account (see PAYSTACK_SECRET_KEY env
  // var), debiting the wallet balance. Paystack's own transfer fee plus our
  // flat markup (see utils/paystack.js computeTransferFee) is added on top
  // of each employee's net pay when the wallet is debited.
  wallet: {
    balance: { type: Number, default: 0, min: 0 }, // Naira
    paystackCustomerCode: { type: String },
    dedicatedAccount: {
      accountNumber: { type: String },
      accountName: { type: String },
      bankName: { type: String },
      bankId: { type: Number },
      active: { type: Boolean, default: false },
    },
    // Maker-checker for MANUAL payroll disbursement (Pay Now / Pay Selected)
    // — off by default so a single-HR_Admin tenant is never accidentally
    // locked out of paying anyone (dual approval needs a second distinct
    // HR_Admin to exist). When on, those actions create a PayrollApproval
    // request instead of calling Paystack directly; a different HR_Admin
    // must approve it from the Payroll Approvals queue before the transfer
    // actually fires. See controllers/payrollApprovalController.js. Does
    // NOT apply to the automatic payday run (see payrollSchedule below) —
    // there's no second admin to click approve on an unattended job, so
    // scheduling the run IS the deliberate authorization.
    requireDualApproval: { type: Boolean, default: false },
  },
  // HR-configured payday — checked once a day by the Agenda job in
  // backend/jobs/payrollScheduler.js. When the day matches (or, if
  // useLastDayOfMonth is set, today IS the last day of the month), every
  // outstanding payslip for the current period is paid in a stable order
  // until the wallet balance runs out; anything left unpaid is skipped and
  // HR is notified. lastRunAt guards against paying twice in one day.
  payrollSchedule: {
    dayOfMonth: { type: Number, min: 1, max: 31, default: 25 },
    useLastDayOfMonth: { type: Boolean, default: false },
    active: { type: Boolean, default: false },
    lastRunAt: { type: Date },
  },
  // Company-wide annual leave entitlement, in working days, per leave type.
  // Applies to every employee equally (no per-employee/role overrides).
  // These defaults are applied automatically by Mongoose the moment a
  // Tenant is created (see tenantController.createTenant) — HR can then
  // adjust them any time from the Leave Management tab.
  // A value of 0 means "no cap" (used for Unpaid leave by default).
  leavePolicy: {
    Annual:        { type: Number, default: 20, min: 0 },
    Sick:          { type: Number, default: 12, min: 0 },
    Maternity:     { type: Number, default: 90, min: 0 },
    Paternity:     { type: Number, default: 10, min: 0 },
    Compassionate: { type: Number, default: 5,  min: 0 },
    Study:         { type: Number, default: 10, min: 0 },
    Unpaid:        { type: Number, default: 0,  min: 0 }, // 0 = unlimited
    Emergency:     { type: Number, default: 5,  min: 0 },
    // Optional extra approval step, off by default. When on, a leave
    // request that has a relief officer assigned must get that relief
    // officer's sign-off before it can reach the manager step — see
    // controllers/leaveController.js updateLeaveStatus. When off (or the
    // requester didn't pick a relief officer), the chain behaves exactly
    // as before: Pending -> Manager Approved -> HR Approved -> Processed.
    requireReliefOfficer: { type: Boolean, default: false },
  },
  // How long to keep an offboarded employee's personal data before it's
  // flagged for HR to review and anonymize. Default of 6 years is a common
  // Nigerian statutory floor for payroll/tax records (FIRS), but this is a
  // starting point, not tax advice — HR should confirm the right figure for
  // their records and adjust it under Compliance > Data Retention.
  dataRetention: {
    offboardedRetentionYears: { type: Number, default: 6, min: 1 },
  },
  // Desktop-agent monitoring (see backend/controllers/monitoringController.js
  // and /desktop-agent). Screenshot capture is OFF by default — HR has to
  // explicitly turn it on here, and even then each individual employee must
  // separately consent inside the agent before any screenshot is captured
  // for them (see Employee.monitoringConsent). This flag has no effect on
  // the in-app active-time tracking (Tenant has no switch for that — it's
  // always-on, low-sensitivity, and disclosed in the general privacy
  // notice), only on screenshots specifically.
  monitoring: {
    screenshotsEnabled: { type: Boolean, default: false },
    screenshotIntervalMinutes: { type: Number, default: 30, min: 5 },
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Tenant = mongoose.model('Tenant', tenantSchema);
export default Tenant;
