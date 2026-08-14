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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Tenant = mongoose.model('Tenant', tenantSchema);
export default Tenant;
