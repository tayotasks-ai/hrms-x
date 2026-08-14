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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Tenant = mongoose.model('Tenant', tenantSchema);
export default Tenant;
