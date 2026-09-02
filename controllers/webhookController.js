import Tenant from '../models/Tenant.js';
import Payslip from '../models/Payslip.js';
import Employee from '../models/Employee.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { getPlatformSecretKey, verifyWebhookSignature } from '../utils/paystack.js';
import { sendEmail } from '../utils/email.js';
import { payslipAvailable } from '../utils/emailTemplates.js';
import { notifyHrAdmins } from '../utils/notify.js';
import User from '../models/User.js';
import { isInvoecrReference, forwardToInvoecr } from '../utils/invoecrForward.js';

// POST /api/webhooks/paystack – PUBLIC, no tenant header, no auth.
//
// Under the wallet model every call to Paystack — wallet funding AND payroll
// transfers — goes through the PLATFORM's own Paystack account, so (unlike
// the old per-tenant BYOK model) there's only ever one secret key to verify
// the signature against: process.env.PAYSTACK_SECRET_KEY.
//
// Two families of event land here:
//   - charge.success — someone paid into a tenant's dedicated virtual
//     account (wallet funding). The tenant is identified by
//     data.customer.customer_code, matched against
//     Tenant.wallet.paystackCustomerCode.
//   - transfer.success / transfer.failed / transfer.reversed — a payroll
//     disbursement we initiated. The tenant + payslip are identified by the
//     `hrms_<tenantId>_<payslipId>_<random>` reference we generate in
//     payslipPaymentController.js. On failure/reversal the amount already
//     debited from the wallet at initiation time is refunded.
export const handlePaystackWebhook = async (req, res) => {
  try {
    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) {
      console.error('Paystack webhook: platform key not configured —', err.message);
      return res.sendStatus(200); // ack so Paystack doesn't retry-storm us over our own config gap
    }

    const signature = req.headers['x-paystack-signature'];
    const valid = verifyWebhookSignature(req.rawBody, signature, secretKey);
    if (!valid) {
      console.error('Paystack webhook: invalid signature.');
      return res.sendStatus(400);
    }

    const event = req.body.event;
    const data = req.body.data || {};

    // This Paystack account is shared with invoecr, a separate invoicing
    // product — see utils/invoecrForward.js for the full reasoning. invoecr
    // events are identified by their `ivcr_`-prefixed reference and never
    // touch our local business logic; we ack Paystack immediately, then
    // forward the untouched raw bytes + signature to invoecr's own webhook
    // as best-effort background work (not awaited — a slow/unreachable
    // invoecr must never delay or fail OUR ack to Paystack).
    if (isInvoecrReference(data.reference)) {
      res.sendStatus(200);
      forwardToInvoecr(req.rawBody, signature, data.reference);
      return;
    }

    if (event === 'charge.success') {
      await handleWalletFunding(data);
      return res.sendStatus(200);
    }

    if (event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') {
      await handleTransferEvent(event, data);
      return res.sendStatus(200);
    }

    // Other events (e.g. dedicatedaccount.assign.success, transfer.otp_pending) — no action needed.
    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook handling error:', err.message);
    // Still 200 so Paystack doesn't hammer retries over our own bug; the
    // affected wallet/payslip will show as stuck and can be reconciled
    // manually.
    res.sendStatus(200);
  }
};

// A dedicated-account funding event. Idempotent on `reference` — Paystack
// can and does redeliver webhooks, so we only credit once per reference.
const handleWalletFunding = async (data) => {
  const customerCode = data.customer?.customer_code;
  const reference = data.reference;
  if (!customerCode || !reference) return;

  const tenant = await Tenant.findOne({ 'wallet.paystackCustomerCode': customerCode }).select('_id wallet.balance');
  if (!tenant) return; // not one of ours (or a stray test event)

  const already = await WalletTransaction.findOne({ reference, type: 'Funding' });
  if (already) return; // already credited — duplicate delivery

  const amountNaira = (data.amount || 0) / 100;
  if (!(amountNaira > 0)) return;

  const updated = await Tenant.findOneAndUpdate(
    { _id: tenant._id },
    { $inc: { 'wallet.balance': amountNaira } },
    { new: true }
  ).select('wallet.balance');

  await WalletTransaction.create({
    tenantId: tenant._id,
    type: 'Funding',
    amount: amountNaira,
    balanceAfter: updated.wallet.balance,
    reference,
    status: 'Success',
  });

  notifyHrAdmins(User, tenant._id, {
    type: 'wallet_funded',
    title: 'Payroll wallet funded',
    message: `₦${amountNaira.toLocaleString()} was received into your payroll wallet. New balance: ₦${updated.wallet.balance.toLocaleString()}.`,
    link: 'wallet',
  });
};

// A payroll transfer's terminal (or reversed) status coming back.
const handleTransferEvent = async (event, data) => {
  const reference = data.reference;
  if (!reference || typeof reference !== 'string' || !reference.startsWith('hrms_')) return;

  const parts = reference.split('_');
  const tenantId = parts[1];
  const payslip = await Payslip.findOne({ tenantId, 'payment.reference': reference });
  if (!payslip) return;

  if (event === 'transfer.success') {
    if (payslip.payment.status === 'Paid') return; // already handled synchronously
    payslip.payment.status = 'Paid';
    payslip.payment.paidAt = new Date();
    await payslip.save();

    const emp = await Employee.findById(payslip.employeeId);
    if (emp?.email) {
      const tpl = payslipAvailable({ employeeName: emp.name, period: payslip.period, netPay: payslip.netPay });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }
    return;
  }

  // transfer.failed / transfer.reversed — refund the wallet if we haven't
  // already. payment.status enum has no distinct "refunded" state, so the
  // real idempotency guard is the WalletTransaction Refund-row check below.
  if (payslip.payment.status !== 'Failed') {
    payslip.payment.status = 'Failed';
    payslip.payment.failureReason = data.reason || event;
    await payslip.save();
  }

  const debit = await WalletTransaction.findOne({ reference, type: 'Payroll_Debit' });
  if (debit && !(await WalletTransaction.findOne({ reference, type: 'Refund' }))) {
    const updated = await Tenant.findOneAndUpdate(
      { _id: tenantId },
      { $inc: { 'wallet.balance': debit.amount } },
      { new: true }
    ).select('wallet.balance');

    await WalletTransaction.create({
      tenantId,
      type: 'Refund',
      amount: debit.amount,
      balanceAfter: updated.wallet.balance,
      reference,
      status: 'Success',
      relatedPayslip: payslip._id,
      meta: { reason: 'Transfer failed after initiation', originalEvent: event },
    });

    notifyHrAdmins(User, tenantId, {
      type: 'payroll_transfer_failed',
      title: 'A payroll transfer failed',
      message: `The transfer for ${payslip.period} failed after your wallet was debited — ₦${debit.amount.toLocaleString()} has been refunded to your balance.`,
      link: 'payroll',
    });
  }
};
