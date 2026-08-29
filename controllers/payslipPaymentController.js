import crypto from 'crypto';
import Payslip from '../models/Payslip.js';
import Employee from '../models/Employee.js';
import Tenant from '../models/Tenant.js';
import PayrollApproval from '../models/PayrollApproval.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { getPlatformSecretKey, computeTransferFee, initiateTransfer, finalizeTransfer, verifyTransfer, PaystackError } from '../utils/paystack.js';
import { recordAudit } from '../utils/auditLog.js';
import { sendEmail } from '../utils/email.js';
import { payslipAvailable } from '../utils/emailTemplates.js';
import { notifyHrAdmins } from '../utils/notify.js';
import User from '../models/User.js';

// References are generated as hrms_<tenantId>_<payslipId>_<random> so the
// PUBLIC webhook (which has no X-Tenant-ID header) can recover which
// tenant/payslip an incoming event belongs to purely from the reference.
// See controllers/webhookController.js.
const makeReference = (tenantId, payslipId) =>
  `hrms_${tenantId}_${payslipId}_${crypto.randomBytes(4).toString('hex')}`;

// Maps a Paystack transfer status onto our payment.status enum.
const mapTransferStatus = (paystackStatus) => {
  if (paystackStatus === 'success') return 'Paid';
  if (paystackStatus === 'otp') return 'Pending_OTP';
  if (paystackStatus === 'failed' || paystackStatus === 'reversed') return 'Failed';
  return 'Processing'; // 'pending' or anything else in flight
};

// True unless the platform has confirmed Paystack "Registered Payroll"
// stamp-duty exemption — see utils/paystack.js computeTransferFee.
const stampDutyApplies = () => process.env.PAYSTACK_STAMP_DUTY_EXEMPT !== 'true';

// Runs the actual Paystack call for one payslip. Shared by the single-pay,
// batch-pay, and payroll-approval / scheduled-payday paths. Mutates and
// saves the payslip; returns a plain result object rather than throwing, so
// callers can collect per-item outcomes.
//
// Wallet accounting: the employee's net pay PLUS Paystack's own transfer
// fee PLUS our flat markup is debited from the tenant's wallet ATOMICALLY
// (a single conditional $inc — see below) before Paystack is ever called.
// If the wallet can't cover it, we never call Paystack at all and return
// `insufficientBalance: true` so batch/scheduled callers can tell that
// apart from a "real" payment failure. If Paystack itself then rejects the
// transfer outright, the debit is refunded immediately; if it's accepted
// but fails later, the webhook (webhookController.js) does the refund.
//
// isTestAccount (Tenant.isTestAccount, set from the platform dashboard for
// orgs helping us test the product) waives every fee — Paystack fee, stamp
// duty, and our own markup — so only the raw net pay is debited. The
// platform absorbs the real Paystack cost for these accounts; that's a
// deliberate choice, not an oversight.
export const payOnePayslip = async (payslip, secretKey, tenantId, actor, { isTestAccount = false } = {}) => {
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

  const fee = isTestAccount
    ? { paystackFee: 0, stampDuty: 0, markup: 0, total: 0 }
    : computeTransferFee(payslip.netPay, { stampDutyApplies: stampDutyApplies() });
  const totalDebit = payslip.netPay + fee.total;
  const reference = makeReference(tenantId, payslip._id);

  // Atomic conditional debit — the $gte guard is what makes this safe
  // against a concurrent "Pay Selected" batch or an overlapping scheduled
  // run double-spending the same balance. If nothing matches, the wallet
  // is short and we stop here without touching Paystack.
  const debited = await Tenant.findOneAndUpdate(
    { _id: tenantId, 'wallet.balance': { $gte: totalDebit } },
    { $inc: { 'wallet.balance': -totalDebit } },
    { new: true }
  ).select('wallet.balance');

  if (!debited) {
    return {
      ok: false,
      payslipId: payslip._id,
      insufficientBalance: true,
      shortfall: totalDebit,
      message: `Insufficient wallet balance for ${emp.name} — needs ₦${totalDebit.toLocaleString()} (₦${payslip.netPay.toLocaleString()} net pay + ₦${fee.total.toLocaleString()} fees).`,
    };
  }

  await WalletTransaction.create({
    tenantId,
    type: 'Payroll_Debit',
    amount: totalDebit,
    balanceAfter: debited.wallet.balance,
    reference,
    status: 'Pending',
    relatedPayslip: payslip._id,
    meta: { netPay: payslip.netPay, ...fee },
  });

  try {
    const result = await initiateTransfer(secretKey, {
      amountNaira: payslip.netPay,
      recipientCode: emp.bankDetails.paystackRecipientCode,
      // Plain ASCII only, with a trailing separator: Nigerian banks' NIP SMS
      // gateways silently drop unsupported characters (the em dash "—" was
      // vanishing entirely, leaving "payment  August 2026" with a stray
      // double space) and several of them concatenate whatever we send
      // directly against the sender's business name with no separator of
      // their own — hence alerts reading like "...2026KumuTech". The
      // trailing " | " guarantees a visible break no matter what gets
      // appended after it.
      reason: `Salary payment - ${payslip.period} | `,
      reference,
    });

    payslip.payment = {
      status: mapTransferStatus(result.status),
      reference,
      transferCode: result.transfer_code,
      paidAt: result.status === 'success' ? new Date() : undefined,
    };
    await payslip.save();

    if (payslip.payment.status === 'Paid') {
      await WalletTransaction.updateOne({ reference, type: 'Payroll_Debit' }, { status: 'Success' });
    }

    recordAudit({
      tenantId, actor,
      targetType: 'Payslip', targetId: payslip._id, targetName: `${emp.name} — ${payslip.period}`,
      changes: [{ field: 'Payment', from: 'Unpaid', to: payslip.payment.status }],
    });

    if (payslip.payment.status === 'Paid' && emp.email) {
      const tpl = payslipAvailable({ employeeName: emp.name, period: payslip.period, netPay: payslip.netPay });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    return { ok: true, payslipId: payslip._id, status: payslip.payment.status, requiresOtp: payslip.payment.status === 'Pending_OTP', debited: totalDebit };
  } catch (err) {
    // Paystack rejected the transfer outright (not just "pending") — refund
    // the wallet right away rather than waiting on a webhook that will
    // never arrive for a request that never really started.
    const refunded = await Tenant.findOneAndUpdate(
      { _id: tenantId },
      { $inc: { 'wallet.balance': totalDebit } },
      { new: true }
    ).select('wallet.balance');

    await WalletTransaction.updateOne({ reference, type: 'Payroll_Debit' }, { status: 'Failed' });
    await WalletTransaction.create({
      tenantId,
      type: 'Refund',
      amount: totalDebit,
      balanceAfter: refunded.wallet.balance,
      reference,
      status: 'Success',
      relatedPayslip: payslip._id,
      meta: { reason: 'Transfer initiation failed', error: err.message },
    });

    payslip.payment = { ...(payslip.payment?.toObject?.() || {}), status: 'Failed', reference, failureReason: err.message };
    await payslip.save().catch(() => {});
    const message = err instanceof PaystackError ? err.message : err.message;
    return { ok: false, payslipId: payslip._id, message };
  }
};

// Shared by payPayslip/payBatch when the tenant has maker-checker turned on
// (Tenant.wallet.requireDualApproval). Instead of calling Paystack now,
// files a PayrollApproval request that a *different* HR_Admin must approve
// from the Payroll Approvals queue — see payrollApprovalController.js,
// which is the only place that ever actually calls payOnePayslip for these.
// Wallet balance isn't checked here — it's checked atomically inside
// payOnePayslip when the approval is actually acted on.
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

// Notifies HR once, summarizing every payslip a batch/scheduled run
// couldn't pay because the wallet ran dry — "pay what it covers, skip the
// rest" per the founders' decision on low-balance handling.
const notifyInsufficientBalance = (tid, results) => {
  const short = results.filter(r => r.insufficientBalance);
  if (short.length === 0) return;
  const totalShortfall = short.reduce((sum, r) => sum + (r.shortfall || 0), 0);
  notifyHrAdmins(User, tid, {
    type: 'wallet_insufficient_balance',
    title: 'Payroll wallet ran out of balance',
    message: `${short.length} payslip${short.length === 1 ? '' : 's'} could not be paid — the wallet is short by about ₦${totalShortfall.toLocaleString()}. Top up and re-run for the rest.`,
    link: 'wallet',
  });
};

// POST /api/payslips/:id/pay – HR only
export const payPayslip = async (req, res) => {
  try {
    const tid = req.tenantId;
    const payslip = await Payslip.findOne({ _id: req.params.id, tenantId: tid });
    if (!payslip) return res.status(404).json({ success: false, message: 'Payslip not found.' });

    const actor = { id: req.user._id, name: req.user.name, model: 'User' };
    const tenant = await Tenant.findById(tid).select('wallet.requireDualApproval isTestAccount');

    if (tenant?.wallet?.requireDualApproval) {
      const { approval, skipped } = await createApprovalRequest(tid, [req.params.id], actor);
      if (!approval) return res.status(400).json({ success: false, message: skipped[0]?.message || 'Nothing to submit for approval.' });
      return res.json({ success: true, message: 'Submitted for approval. A different HR admin must approve it before payment.', data: { requiresApproval: true, approvalId: approval._id } });
    }

    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) { return res.status(503).json({ success: false, message: err.message }); }

    const result = await payOnePayslip(payslip, secretKey, tid, actor, { isTestAccount: !!tenant?.isTestAccount });

    if (!result.ok) return res.status(400).json({ success: false, message: result.message, data: result });
    res.json({ success: true, message: result.requiresOtp ? 'Transfer requires an OTP to finalize.' : 'Payment initiated.', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/payslips/pay-batch – HR only. Body: { payslipIds: [] }
// Pays each payslip independently via the single-transfer API (not
// Paystack's /transfer/bulk) so partial failures, per-employee OTP
// requirements, and wallet exhaustion are all handled the same way as a
// one-off payment, with a clear per-row result.
export const payBatch = async (req, res) => {
  try {
    const tid = req.tenantId;
    const ids = Array.isArray(req.body.payslipIds) ? req.body.payslipIds : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'No payslipIds provided.' });
    if (ids.length > 100) return res.status(400).json({ success: false, message: 'Batch payment is limited to 100 payslips at a time.' });

    const actor = { id: req.user._id, name: req.user.name, model: 'User' };
    const tenant = await Tenant.findById(tid).select('wallet.requireDualApproval isTestAccount');

    if (tenant?.wallet?.requireDualApproval) {
      const { approval, skipped } = await createApprovalRequest(tid, ids, actor);
      if (!approval) return res.status(400).json({ success: false, message: 'Nothing to submit for approval.', data: skipped });
      return res.json({
        success: true,
        message: `Submitted ${approval.payslipIds.length} of ${ids.length} payslip(s) for approval. A different HR admin must approve before payment.`,
        data: { requiresApproval: true, approvalId: approval._id, skipped },
      });
    }

    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) { return res.status(503).json({ success: false, message: err.message }); }

    const isTestAccount = !!tenant?.isTestAccount;
    const results = [];
    for (const id of ids) {
      const payslip = await Payslip.findOne({ _id: id, tenantId: tid });
      if (!payslip) { results.push({ ok: false, payslipId: id, message: 'Payslip not found.' }); continue; }
      results.push(await payOnePayslip(payslip, secretKey, tid, actor, { isTestAccount }));
    }

    notifyInsufficientBalance(tid, results);

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
// The wallet debit already happened at initiation — finalizing only
// changes whether Paystack actually sends the money, not the balance.
export const finalizePayslipPayment = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: 'otp is required.' });

    const payslip = await Payslip.findOne({ _id: req.params.id, tenantId: tid });
    if (!payslip) return res.status(404).json({ success: false, message: 'Payslip not found.' });
    if (payslip.payment?.status !== 'Pending_OTP')
      return res.status(400).json({ success: false, message: `Payment is not awaiting OTP (currently ${payslip.payment?.status || 'Unpaid'}).` });

    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) { return res.status(503).json({ success: false, message: err.message }); }

    try {
      const result = await finalizeTransfer(secretKey, { transferCode: payslip.payment.transferCode, otp });
      payslip.payment.status = mapTransferStatus(result.status);
      if (payslip.payment.status === 'Paid') {
        payslip.payment.paidAt = new Date();
        await WalletTransaction.updateOne({ reference: payslip.payment.reference, type: 'Payroll_Debit' }, { status: 'Success' });
      }
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

      // The OTP finalize failed outright (not just declined-then-retryable)
      // — refund, same as a failed initiation.
      const debit = await WalletTransaction.findOne({ reference: payslip.payment.reference, type: 'Payroll_Debit', status: { $ne: 'Failed' } });
      if (debit) {
        const refunded = await Tenant.findOneAndUpdate({ _id: tid }, { $inc: { 'wallet.balance': debit.amount } }, { new: true }).select('wallet.balance');
        await WalletTransaction.updateOne({ _id: debit._id }, { status: 'Failed' });
        await WalletTransaction.create({
          tenantId: tid, type: 'Refund', amount: debit.amount, balanceAfter: refunded.wallet.balance,
          reference: payslip.payment.reference, status: 'Success', relatedPayslip: payslip._id,
          meta: { reason: 'OTP finalize failed', error: err.message },
        });
      }

      res.status(400).json({ success: false, message: err instanceof PaystackError ? err.message : err.message });
    }
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/payslips/:id/reset-payment – HR only. Body: { force?: boolean }
// For a payslip stuck on Pending_OTP with no practical way to enter the
// OTP — the platform initiates every transfer under ONE shared Paystack
// secret key, so Paystack's OTP goes to whoever is registered on the
// PLATFORM's own account, not the tenant paying. There's no way for an
// individual organisation to receive or enter it.
//
// Default (force !== true): does NOT trust a timer or just assume the
// transfer is dead — it asks Paystack directly (Verify Transfer) what the
// transfer's real current status is, and only resets payment status /
// refunds the wallet if Paystack confirms it's in a genuinely terminal,
// non-processing state (abandoned/failed/reversed). If Paystack still
// reports it live (pending/otp) we refuse, so there's no risk of resetting
// a transfer Paystack might still complete and double-crediting the
// wallet.
//
// force === true: HR has explicitly acknowledged the risk (see the
// frontend confirm modal) and wants to reset anyway even though Paystack
// still reports the transfer as live. We still try to check Paystack first
// — if it turns out the transfer actually succeeded, we sync to Paid
// instead of blindly resetting, since that's cheap insurance against the
// worst outcome. But if Paystack still says it's live (or the check
// itself fails), we proceed with the reset regardless. This can genuinely
// result in the employee being paid AND the wallet being refunded as if
// they weren't — that trade-off is the caller's explicit choice, not ours.
export const resetStuckPayment = async (req, res) => {
  try {
    const tid = req.tenantId;
    const force = req.body?.force === true;
    const payslip = await Payslip.findOne({ _id: req.params.id, tenantId: tid });
    if (!payslip) return res.status(404).json({ success: false, message: 'Payslip not found.' });
    if (payslip.payment?.status !== 'Pending_OTP')
      return res.status(400).json({ success: false, message: `Only a payment stuck "Awaiting OTP" can be reset (currently "${payslip.payment?.status || 'Unpaid'}").` });

    const reference = payslip.payment.reference;
    if (!reference) return res.status(400).json({ success: false, message: 'No transfer reference on this payslip — nothing to check.' });

    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) { return res.status(503).json({ success: false, message: err.message }); }

    let paystackStatus = null;
    try {
      const result = await verifyTransfer(secretKey, reference);
      paystackStatus = result.status;
    } catch (err) {
      if (!force) return res.status(502).json({ success: false, message: `Could not check the transfer's status with Paystack: ${err.message}` });
      paystackStatus = 'unknown (Paystack check failed)';
    }

    // Regardless of force, never overwrite an actually-successful transfer.
    if (paystackStatus === 'success') {
      payslip.payment.status = 'Paid';
      payslip.payment.paidAt = payslip.payment.paidAt || new Date();
      await payslip.save();
      await WalletTransaction.updateOne({ reference, type: 'Payroll_Debit' }, { status: 'Success' });
      return res.json({ success: true, message: 'This transfer actually went through on Paystack — payslip marked Paid instead of reset.', data: { status: 'Paid' } });
    }

    const terminalNonLive = ['abandoned', 'failed', 'reversed'].includes(paystackStatus);
    if (!terminalNonLive && !force) {
      return res.status(400).json({
        success: false,
        message: `Paystack still shows this transfer as "${paystackStatus}" — it may still complete, so it can't be reset yet. Try again shortly.`,
      });
    }

    payslip.payment.status = 'Failed';
    payslip.payment.failureReason = force && !terminalNonLive
      ? `Force-reset by HR while Paystack still reported "${paystackStatus}"`
      : `Reset by HR after Paystack confirmed status "${paystackStatus}"`;
    await payslip.save();

    let refunded = false;
    const debit = await WalletTransaction.findOne({ reference, type: 'Payroll_Debit' });
    if (debit && !(await WalletTransaction.findOne({ reference, type: 'Refund' }))) {
      const updated = await Tenant.findOneAndUpdate(
        { _id: tid },
        { $inc: { 'wallet.balance': debit.amount } },
        { new: true }
      ).select('wallet.balance');
      await WalletTransaction.updateOne({ _id: debit._id }, { status: 'Failed' });
      await WalletTransaction.create({
        tenantId: tid,
        type: 'Refund',
        amount: debit.amount,
        balanceAfter: updated.wallet.balance,
        reference,
        status: 'Success',
        relatedPayslip: payslip._id,
        meta: { reason: force && !terminalNonLive ? 'Force reset — stuck OTP payment (Paystack still live)' : 'Manual reset — stuck OTP payment', paystackStatus },
      });
      refunded = true;
    }

    recordAudit({
      tenantId: tid,
      actor: { id: req.user._id, name: req.user.name, model: 'User' },
      targetType: 'Payslip', targetId: payslip._id, targetName: `${payslip.period} payment ${force && !terminalNonLive ? 'force-reset' : 'reset'}`,
      changes: [{ field: 'Payment', from: 'Pending_OTP', to: 'Failed' }],
    });

    const message = force && !terminalNonLive
      ? `Payment force-reset while Paystack still showed "${paystackStatus}". Wallet refunded — if the original transfer completes later, the employee may be paid twice. Double-check reference ${reference} on Paystack before assuming it's clear.`
      : `Payment reset — Paystack confirmed this transfer as "${paystackStatus}".${refunded ? ' Wallet refunded, ready to pay again.' : ''}`;

    res.json({ success: true, message, data: { status: 'Failed', forced: force && !terminalNonLive } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
