import mongoose from 'mongoose';

// A maker-checker request for a payroll disbursement run. Created instead
// of paying directly when Tenant.paystack.requireDualApproval is on (see
// controllers/payslipPaymentController.js). A different HR_Admin than the
// one who requested it must approve before Paystack is actually called —
// enforced in controllers/payrollApprovalController.js, not just in the UI.
const payrollApprovalSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  payslipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payslip', required: true }],
  period: { type: String }, // display convenience — payslips in a request are usually one period
  totalAmount: { type: Number, default: 0 }, // sum of netPay at request time
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },

  requestedBy: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: String,
    model: { type: String, enum: ['User'], default: 'User' }, // only HR_Admins can initiate a payroll run
  },
  requestedAt: { type: Date, default: Date.now },

  decidedBy: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
    model: { type: String, enum: ['User'] },
  },
  decidedAt: Date,
  rejectionReason: String,

  // Filled in once Approved and payOnePayslip has actually run for each
  // payslip, mirroring the per-row result shape payBatch already returns.
  results: [{
    payslipId: mongoose.Schema.Types.ObjectId,
    ok: Boolean,
    status: String,
    message: String,
  }],
}, { timestamps: true });

payrollApprovalSchema.index({ tenantId: 1, status: 1, requestedAt: -1 });

const PayrollApproval = mongoose.model('PayrollApproval', payrollApprovalSchema);
export default PayrollApproval;
