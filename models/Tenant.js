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
  // Per-tenant Paystack credentials for payroll disbursement. Each tenant
  // company connects its OWN Paystack business account — this platform never
  // holds or moves tenant funds itself, it only calls Paystack's Transfers
  // API using the tenant's own secret key.
  paystack: {
    secretKeyEncrypted: { type: String, select: false },
    connected: { type: Boolean, default: false },
    connectedAt: { type: Date },
    // Maker-checker for payroll disbursement — off by default so a
    // single-HR_Admin tenant is never accidentally locked out of paying
    // anyone (dual approval needs a second distinct HR_Admin to exist).
    // When on, Pay Now / Pay Selected creates a PayrollApproval request
    // instead of calling Paystack directly; a different HR_Admin must
    // approve it from the Payroll Approvals queue before the transfer
    // actually fires. See controllers/payrollApprovalController.js.
    requireDualApproval: { type: Boolean, default: false },
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
