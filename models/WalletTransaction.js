import mongoose from 'mongoose';

// A single append-only ledger entry for a tenant's payroll wallet. The
// wallet's live balance lives on Tenant.wallet.balance (for fast reads);
// this collection is the audit trail explaining how it got there. Every
// balance change — funding in, a payroll debit out, or a refund back in
// after a failed transfer — gets one row here.
const walletTransactionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

  type: {
    type: String,
    enum: [
      'Funding',        // tenant transferred money into their dedicated virtual account
      'Payroll_Debit',  // wallet debited to pay one employee's payslip (net pay + fees)
      'Refund',         // a Payroll_Debit reversed because the Paystack transfer itself failed
    ],
    required: true,
  },
  amount: { type: Number, required: true }, // Naira, always a positive magnitude
  balanceAfter: { type: Number, required: true }, // wallet balance immediately after this entry

  // Paystack's own reference for Funding (the charge) and Payroll_Debit
  // (the transfer) rows, so a support conversation can be matched back to
  // Paystack's dashboard. Refund rows reuse the original debit's reference.
  reference: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'Success', 'Failed'], default: 'Success' },

  relatedPayslip: { type: mongoose.Schema.Types.ObjectId, ref: 'Payslip' },

  // Fee breakdown for Payroll_Debit rows: { netPay, fee, total } — see
  // utils/paystack.js computeTransferFee (flat ₦250 per transfer, waived
  // for isTestAccount tenants). Left empty for Funding/Refund rows.
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

walletTransactionSchema.index({ tenantId: 1, createdAt: -1 });

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);
export default WalletTransaction;
