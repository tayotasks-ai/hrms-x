import PayrollApproval from '../models/PayrollApproval.js';
import Payslip from '../models/Payslip.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import { getPlatformSecretKey } from '../utils/paystack.js';
import { payOnePayslip } from './payslipPaymentController.js';
import { recordAudit } from '../utils/auditLog.js';
import { notify, notifyHrAdmins } from '../utils/notify.js';

// GET /api/payroll-approvals – HR only. Query: ?status=Pending (default: all)
export const getPayrollApprovals = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };
    if (req.query.status) query.status = req.query.status;

    const approvals = await PayrollApproval.find(query)
      .populate({ path: 'payslipIds', select: 'employeeId netPay period', populate: { path: 'employeeId', select: 'name' } })
      .sort({ requestedAt: -1 });

    res.json({ success: true, data: approvals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payroll-approvals/:id/approve – HR only.
// The core of maker-checker: the approving admin must be a DIFFERENT
// HR_Admin than whoever requested the run. Enforced here, not just hidden
// in the UI, since this is the actual control that matters.
export const approvePayrollApproval = async (req, res) => {
  try {
    const tid = req.tenantId;
    const approval = await PayrollApproval.findOne({ _id: req.params.id, tenantId: tid });
    if (!approval) return res.status(404).json({ success: false, message: 'Approval request not found.' });
    if (approval.status !== 'Pending')
      return res.status(400).json({ success: false, message: `This request is already ${approval.status.toLowerCase()}.` });

    if (approval.requestedBy.id.toString() === req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You cannot approve a payroll run you initiated yourself. Ask another HR admin to review it.' });
    }

    const actor = { id: req.user._id, name: req.user.name, model: 'User' };
    const tenant = await Tenant.findById(tid).select('isTestAccount isDemoAccount name');

    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) {
      if (!tenant?.isDemoAccount) return res.status(503).json({ success: false, message: err.message });
      secretKey = 'demo';
    }

    const results = [];
    for (const payslipId of approval.payslipIds) {
      const payslip = await Payslip.findOne({ _id: payslipId, tenantId: tid });
      if (!payslip) { results.push({ payslipId, ok: false, message: 'Payslip not found.' }); continue; }
      const result = await payOnePayslip(payslip, secretKey, tid, actor, { isTestAccount: !!tenant?.isTestAccount, tenantName: tenant?.name || '', isDemoAccount: !!tenant?.isDemoAccount });
      results.push({ payslipId, ok: result.ok, status: result.status, message: result.message, insufficientBalance: result.insufficientBalance });
    }

    const short = results.filter(r => r.insufficientBalance);
    if (short.length > 0) {
      notifyHrAdmins(User, tid, {
        type: 'wallet_insufficient_balance',
        title: 'Payroll wallet ran out of balance',
        message: `${short.length} of ${results.length} approved payslip(s) could not be paid — the wallet ran out of balance. Top up and re-run the rest from Payroll.`,
        link: 'wallet',
      });
    }

    approval.status = 'Approved';
    approval.decidedBy = actor;
    approval.decidedAt = new Date();
    approval.results = results;
    await approval.save();

    recordAudit({
      tenantId: tid,
      actor,
      targetType: 'PayrollApproval',
      targetId: approval._id,
      targetName: `Payroll run — ₦${approval.totalAmount.toLocaleString()} (${approval.payslipIds.length} payslip${approval.payslipIds.length === 1 ? '' : 's'})`,
      changes: [{ field: 'Status', from: 'Pending', to: 'Approved' }],
    });

    notify({
      tenantId: tid,
      recipientId: approval.requestedBy.id,
      recipientModel: 'User',
      type: 'payroll_approval_decided',
      title: 'Your payroll run was approved',
      message: `${req.user.name} approved your ₦${approval.totalAmount.toLocaleString()} payroll run.`,
      link: 'payroll',
    });

    const succeeded = results.filter(r => r.ok).length;
    res.json({ success: true, message: `${succeeded} of ${results.length} payment(s) initiated.`, data: approval });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/payroll-approvals/:id/reject – HR only. Body: { reason? }
// No requester/approver restriction here — cancelling a run you initiated
// (or rejecting someone else's) never moves money, so it doesn't need the
// dual-control check that approval does.
export const rejectPayrollApproval = async (req, res) => {
  try {
    const tid = req.tenantId;
    const approval = await PayrollApproval.findOne({ _id: req.params.id, tenantId: tid });
    if (!approval) return res.status(404).json({ success: false, message: 'Approval request not found.' });
    if (approval.status !== 'Pending')
      return res.status(400).json({ success: false, message: `This request is already ${approval.status.toLowerCase()}.` });

    const actor = { id: req.user._id, name: req.user.name, model: 'User' };
    approval.status = 'Rejected';
    approval.decidedBy = actor;
    approval.decidedAt = new Date();
    approval.rejectionReason = req.body.reason || '';
    await approval.save();

    recordAudit({
      tenantId: tid,
      actor,
      targetType: 'PayrollApproval',
      targetId: approval._id,
      targetName: `Payroll run — ₦${approval.totalAmount.toLocaleString()} (${approval.payslipIds.length} payslip${approval.payslipIds.length === 1 ? '' : 's'})`,
      changes: [{ field: 'Status', from: 'Pending', to: 'Rejected' }],
    });

    if (approval.requestedBy.id.toString() !== req.user._id.toString()) {
      notify({
        tenantId: tid,
        recipientId: approval.requestedBy.id,
        recipientModel: 'User',
        type: 'payroll_approval_decided',
        title: 'Your payroll run was rejected',
        message: `${req.user.name} rejected your ₦${approval.totalAmount.toLocaleString()} payroll run.${approval.rejectionReason ? ' Reason: ' + approval.rejectionReason : ''}`,
        link: 'payroll',
      });
    }

    res.json({ success: true, message: 'Payroll run rejected.', data: approval });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
