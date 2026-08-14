import crypto from 'crypto';
import Payslip from '../models/Payslip.js';
import Employee from '../models/Employee.js';
import Tenant from '../models/Tenant.js';
import PayrollApproval from '../models/PayrollApproval.js';
import { getDecryptedPaystackKey } from './paymentSettingsController.js';
import { initiateTransfer, finalizeTransfer, PaystackError } from '../utils/paystack.js';
import { recordAudit } from '../utils/auditLog.js';
import { sendEmail } from '../utils/email.js';
import { payslipAvailable } from '../utils/emailTemplates.js';
import { notifyHrAdmins } from '../utils/notify.js';
import User from '../models/User.js';

// References are generated as hrms_<tenantId>_<payslipId>_<random> so the
// PUBLIC webhook (which has no X-Tenant-ID header) can recover which
// tenant's Paystack secret key to verify the signature against, purely from
// the reference on the incoming event. See controllers/webhookController.js.
const makeReference = (tenantId, payslipId) =>
  `hrms_${tenantId}_${payslipId}_${crypto.randomBytes(4).toString('hex')}`;

// Maps a Paystack transfer status onto our payment.status enum.
const mapTransferStatus = (paystackStatus) => {
  if (paystackStatus === 'success') return 'Paid';
  if (paystackStatus === 'otp') return 'Pending_OTP';
  if (paystackStatus === 'failed' || paystackStatus === 'reversed') return 'Failed';
  return 'Processing'; // 'pending' or anything else in flight
};

// Runs the actual Paystack call for one payslip. Shared by the single-pay
// and batch-pay endpoints. Mutates and saves the payslip; returns a plain
// result object rather than throwing, so batch callers can collect
// per-item outcomes the same way bulkCreateEmployees does for imports.
export const payOnePayslip = async (payslip, secretKey, tenantId, actor) => {
  if (['Processing', 'Pending_OTP', 'Paid'].includes(payslip.payment?.status)) {
    return { ok: false, payslipId: payslip._id, message: `Payment already ${payslip.payment.status}.` };
  }

  const emp = await Employee.findOne({ _id: payslip.employeeId, tenantId });
  if (!emp) return { ok: false, payslipId: payslip._id, message: 'Employee not found.' };
  if (!emp.bankDetails?.verified || !emp.bankDetails?.paystackRecipientCode) {
    return { ok: false, payslipId: payslip._id, message: `${emp.name} has no verified bank account.` };
  }
  if (!(payslip.netPay > 0)) {
    return { ok: false, payslipId: payslip._id, message: 'Net pay must be greater than zero.' };
  }

  const reference = makeReference(tenantId, payslip._id);
  try {
    const result = await initiateTransfer(secretKey, {
      amountNaira: payslip.netPay,
      recipientCode: emp.bankDetails.paystackRecipientCode,
      reason: `Salary payment — ${payslip.period}`,
      reference,
    });

    payslip.payment = {
      status: mapTransferStatus(result.status),
      reference,
      transferCode: result.transfer_code,
      paidAt: result.status === 'success' ? new Date() : undefined,
    };
    await payslip.save();

    recordAudit({
      tenantId, actor,
      targetType: 'Payslip', targetId: payslip._id, targetName: `${emp.name} — ${payslip.period}`,
      changes: [{ field: 'Payment', from: 'Unpaid', to: payslip.payment.status }],
    });

    if (payslip.payment.status === 'Paid' && emp.email) {
      const tpl = payslipAvailable({ employeeName: emp.name, period: payslip.period, netPay: payslip.netPay });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    return { ok: true, payslipId: payslip._id, status: payslip.payment.status, requiresOtp: payslip.payment.status === 'Pending_OTP' };
  } catch (err) {
    payslip.payment = { ...(payslip.payment?.toObject?.() || {}), status: 'Failed', reference, failureReason: err.message };
    await payslip.save().catch(() => {});
    const message = err instanceof PaystackError ? err.message : err.message;
    return { ok: false, payslipId: payslip._id, message };
  }
};

// Shared by payPayslip/payBatch when the tenant has maker-checker turned on
// (Tenant.paystack.requireDualApproval). Instead of calling Paystack now,
// files a PayrollApproval request that a *different* HR_Admin must approve
// from the Payroll Approvals queue — see payrollApprovalController.js,
// which is the only place that ever actually calls payOnePayslip for these.
const createApprovalRequest = async (tid, ids, actor) => {
  const payslips = await Payslip.find({ _id: { $in: ids }, tenantId: tid });
  const found = new Map(payslips.map(p => [p._id.toString(), p]));
  const validIds = [];
  const skipped = [];

  for (const id of ids) {
    const p = found.get(String(id));
    if (!p) { skipped.push({ payslipId: id, message: 'Payslip not found.' }); continue; }
    if (['Processing', 'Pending_OTP', 'Paid'].includes(p.payment?.status)) {
      skipped.push({ payslipId: id, message: `Payment already ${p.payment.status}.` });
      continue;
    }
    validIds.push(p._id);
  }

  if (validIds.length === 0) return { approval: null, skipped };

  const totalAmount = validIds.reduce((sum, id) => sum + (found.get(String(id))?.netPay || 0), 0);
  const periods = [...new Set(validIds.map(id => found.get(String(id))?.period).filter(Boolean))];

  const approval = await PayrollApproval.create({
    tenantId: tid,
    payslipIds: validIds,
    period: periods.length === 1 ? periods[0] : periods.length > 1 ? 'Multiple periods' : undefined,
    totalAmount,
    requestedBy: actor,
  });

  notifyHrAdmins(User, tid, {
    type: 'payroll_approval_requested',
    title: 'Payroll run needs approval',
    message: `${actor.name} submitted a ₦${totalAmount.toLocaleString()} payroll run (${validIds.length} payslip${validIds.length === 1 ? '' : 's'}) for approval.`,
    link: 'payroll',
  });

  return { approval, skipped };
};

// POST /api/payslips/:id/pay – HR only
export const payPayslip = async (req, res) => {
  try {
    const tid = req.tenantId;
    const payslip = await Payslip.findOne({ _id: req.params.id, tenantId: tid });
    if (!payslip) return res.status(404).json({ success: false, message: 'Payslip not found.' });

    const actor = { id: req.user._id, name: req.user.name, model: 'User' };
    const tenant = await Tenant.findById(tid).select('paystack.requireDualApproval');

    if (tenant?.paystack?.requireDualApproval) {
      const { approval, skipped } = await createApprovalRequest(tid, [req.params.id], actor);
      if (!approval) return res.status(400).json({ success: false, message: skipped[0]?.message || 'Nothing to submit for approval.' });
      return res.json({ success: true, message: 'Submitted for approval. A different HR admin must approve it before payment.', data: { requiresApproval: true, approvalId: approval._id } });
    }

    const secretKey = await getDecryptedPaystackKey(tid);
    const result = await payOnePayslip(payslip, secretKey, tid, actor);

    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    res.json({ success: true, message: result.requiresOtp ? 'Transfer requires an OTP to finalize.' : 'Payment initiated.', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/payslips/pay-batch – HR only. Body: { payslipIds: [] }
// Pays each payslip independently via the single-transfer API (not
// Paystack's /transfer/bulk) so partial failures and per-employee OTP
// requirements are handled the same way as a one-off payment, with a clear
// per-row result instead of an opaque batch response.
export const payBatch = async (req, res) => {
  try {
    const tid = req.tenantId;
    const ids = Array.isArray(req.body.payslipIds) ? req.body.payslipIds : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'No payslipIds provided.' });
    if (ids.length > 100) return res.status(400).json({ success: false, message: 'Batch payment is limited to 100 payslips at a time.' });

    const actor = { id: req.user._id, name: req.user.name, model: 'User' };
    const tenant = await Tenant.findById(tid).select('paystack.requireDualApproval');

    if (tenant?.paystack?.requireDualApproval) {
      const { approval, skipped } = await createApprovalRequest(tid, ids, actor);
      if (!approval) return res.status(400).json({ success: false, message: 'Nothing to submit for approval.', data: skipped });
      return res.json({
        success: true,
        message: `Submitted ${approval.payslipIds.length} of ${ids.length} payslip(s) for approval. A different HR admin must approve before payment.`,
        data: { requiresApproval: true, approvalId: approval._id, skipped },
      });
    }

    const secretKey = await getDecryptedPaystackKey(tid);

    const results = [];
    for (const id of ids) {
      const payslip = await Payslip.findOne({ _id: id, tenantId: tid });
      if (!payslip) { results.push({ ok: false, payslipId: id, message: 'Payslip not found.' }); continue; }
      results.push(await payOnePayslip(payslip, secretKey, tid, actor));
    }

    const succeeded = results.filter(r => r.ok).length;
    res.json({
      success: succeeded > 0,
      message: `${succeeded} of ${ids.length} payment(s) initiated.`,
      data: results,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/payslips/:id/pay/finalize – HR only. Body: { otp }
// Completes a transfer that came back with payment.status = 'Pending_OTP'.
export const finalizePayslipPayment = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: 'otp is required.' });

    const payslip = await Payslip.findOne({ _id: req.params.id, tenantId: tid });
    if (!payslip) return res.status(404).json({ success: false, message: 'Payslip not found.' });
    if (payslip.payment?.status !== 'Pending_OTP')
      return res.status(400).json({ success: false, message: `Payment is not awaiting OTP (currently ${payslip.payment?.status || 'Unpaid'}).` });

    const secretKey = await getDecryptedPaystackKey(tid);
    try {
      const result = await finalizeTransfer(secretKey, { transferCode: payslip.payment.transferCode, otp });
      payslip.payment.status = mapTransferStatus(result.status);
      if (payslip.payment.status === 'Paid') payslip.payment.paidAt = new Date();
      await payslip.save();

      recordAudit({
        tenantId: tid,
        actor: { id: req.user._id, name: req.user.name, model: 'User' },
        targetType: 'Payslip', targetId: payslip._id, targetName: payslip.period,
        changes: [{ field: 'Payment', from: 'Pending_OTP', to: payslip.payment.status }],
      });

      if (payslip.payment.status === 'Paid') {
        const emp = await Employee.findById(payslip.employeeId);
        if (emp?.email) {
          const tpl = payslipAvailable({ employeeName: emp.name, period: payslip.period, netPay: payslip.netPay });
          sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
        }
      }

      res.json({ success: true, message: 'Transfer finalized.', data: { status: payslip.payment.status } });
    } catch (err) {
      payslip.payment.status = 'Failed';
      payslip.payment.failureReason = err.message;
      await payslip.save();
      res.status(400).json({ success: false, message: err instanceof PaystackError ? err.message : err.message });
    }
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
