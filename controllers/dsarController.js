import DsarRequest from '../models/DsarRequest.js';
import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';
import Payslip from '../models/Payslip.js';
import Kpi from '../models/Kpi.js';
import { PII_SELECT, decryptRegulatoryField } from '../utils/piiDisplay.js';
import { recordAudit } from '../utils/auditLog.js';
import { notify, notifyHrAdmins } from '../utils/notify.js';
import User from '../models/User.js';

// GET /api/employees/me/data-export – self only (NDPA Section 35, right of
// access). Bundles everything this system holds about the requesting
// employee into one JSON payload: profile, leave history, payslips, KPIs.
// Regulatory IDs and bank account number are decrypted in FULL here (not
// masked) — this is the one case where that's correct, since the person
// receiving them is the data subject themselves, not a third party.
export const exportMyData = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'This export is for an employee\'s own account.' });

    const empId = req.user._id;
    const tid = req.tenantId;

    const [emp, leaves, payslips, kpis] = await Promise.all([
      Employee.findById(empId).select(`-password ${PII_SELECT}`).populate('departmentId', 'name').populate('managerId', 'name').lean(),
      Leave.find({ employeeId: empId, tenantId: tid }).lean(),
      Payslip.find({ employeeId: empId, tenantId: tid }).select('-payment.reference -payment.transferCode').lean(),
      Kpi.find({ employeeId: empId, tenantId: tid }).lean(),
    ]);

    if (!emp) return res.status(404).json({ success: false, message: 'Profile not found.' });

    const profile = {
      ...emp,
      regulatory: emp.regulatory ? {
        ...emp.regulatory,
        bvn: decryptRegulatoryField(emp.regulatory.bvn) || null,
        nin: decryptRegulatoryField(emp.regulatory.nin) || null,
        tin: decryptRegulatoryField(emp.regulatory.tin) || null,
        nhf: decryptRegulatoryField(emp.regulatory.nhf) || null,
        rsa: decryptRegulatoryField(emp.regulatory.rsa) || null,
        pfa: decryptRegulatoryField(emp.regulatory.pfa) || null,
      } : emp.regulatory,
      bankDetails: emp.bankDetails ? { ...emp.bankDetails, accountNumber: decryptRegulatoryField(emp.bankDetails.accountNumber) || null } : emp.bankDetails,
    };

    recordAudit({
      tenantId: tid,
      actor: { id: req.user._id, name: req.user.name, model: 'Employee' },
      targetType: 'Employee',
      targetId: emp._id,
      targetName: emp.name,
      changes: [{ field: 'Data export', from: '—', to: 'Downloaded own data (NDPA access request)' }],
    });

    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        profile,
        leaves,
        payslips,
        kpis,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/dsar-requests – Employee only, self. Body: { type, details }
export const createDsarRequest = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employees can file a data request about their own record.' });

    const { type, details } = req.body;
    if (!['Access', 'Correction', 'Erasure'].includes(type))
      return res.status(400).json({ success: false, message: 'type must be one of: Access, Correction, Erasure.' });

    const request = await DsarRequest.create({
      tenantId: req.tenantId,
      employeeId: req.user._id,
      employeeName: req.user.name,
      type,
      details: details || '',
    });

    notifyHrAdmins(User, req.tenantId, {
      type: 'dsar_request',
      title: `New data ${type.toLowerCase()} request`,
      message: `${req.user.name} filed a data ${type.toLowerCase()} request.`,
      link: 'compliance',
    });

    res.status(201).json({ success: true, message: 'Request submitted. HR will review it.', data: request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/dsar-requests – HR only
export const getDsarRequests = async (req, res) => {
  try {
    const requests = await DsarRequest.find({ tenantId: req.tenantId }).sort({ requestedAt: -1 });
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/dsar-requests/:id – HR only. Body: { status, resolutionNote? }
// Statuses are HR-actioned manually — this endpoint records the decision,
// it does not itself delete or modify the employee record. Erasure
// requests still require HR to separately anonymize the employee (see
// retentionController.js) if they decide to grant it.
export const updateDsarRequest = async (req, res) => {
  try {
    const { status, resolutionNote } = req.body;
    if (!['Pending', 'In Progress', 'Completed', 'Rejected'].includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status.' });

    const request = await DsarRequest.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    const prevStatus = request.status;
    request.status = status;
    if (resolutionNote !== undefined) request.resolutionNote = resolutionNote;
    if (['Completed', 'Rejected'].includes(status)) {
      request.resolvedBy = { id: req.user._id, name: req.user.name, model: 'User' };
      request.resolvedAt = new Date();
    }
    await request.save();

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: 'User' },
      targetType: 'DsarRequest',
      targetId: request._id,
      targetName: `${request.type} request — ${request.employeeName}`,
      changes: [{ field: 'Status', from: prevStatus, to: status }],
    });

    notify({
      tenantId: req.tenantId,
      recipientId: request.employeeId,
      recipientModel: 'Employee',
      type: 'dsar_request',
      title: `Your data ${request.type.toLowerCase()} request was updated`,
      message: `Status: ${status}.${resolutionNote ? ' ' + resolutionNote : ''}`,
      link: 'dashboard',
    });

    res.json({ success: true, message: 'Request updated.', data: request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
