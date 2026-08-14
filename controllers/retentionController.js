import Employee from '../models/Employee.js';
import Tenant from '../models/Tenant.js';
import { recordAudit } from '../utils/auditLog.js';

// An employee offboarded before this date has exceeded the retention
// window. Pulled out as a pure function so the date math is unit-testable
// without touching the database.
export const computeRetentionCutoff = (years, now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return cutoff;
};

// GET /api/retention-settings – HR only
export const getRetentionSettings = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('dataRetention.offboardedRetentionYears');
    res.json({ success: true, data: { offboardedRetentionYears: tenant?.dataRetention?.offboardedRetentionYears ?? 6 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/retention-settings – HR only. Body: { offboardedRetentionYears }
export const updateRetentionSettings = async (req, res) => {
  try {
    const years = Number(req.body.offboardedRetentionYears);
    if (!Number.isFinite(years) || years < 1)
      return res.status(400).json({ success: false, message: 'offboardedRetentionYears must be a number of at least 1.' });

    await Tenant.findByIdAndUpdate(req.tenantId, { 'dataRetention.offboardedRetentionYears': years });

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: 'User' },
      targetType: 'PaymentSettings', // reusing the generic settings target type — no dedicated one exists for tenant config
      targetId: req.tenantId,
      targetName: 'Data retention policy',
      changes: [{ field: 'offboardedRetentionYears', from: '—', to: String(years) }],
    });

    res.json({ success: true, message: 'Retention policy updated.', data: { offboardedRetentionYears: years } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/retention/candidates – HR only.
// Offboarded employees whose retention window has elapsed and who haven't
// already been anonymized. Matches on month/day is unnecessary here (unlike
// the holiday/milestone helpers) — this is a straight date comparison.
export const getRetentionCandidates = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('dataRetention.offboardedRetentionYears');
    const years = tenant?.dataRetention?.offboardedRetentionYears ?? 6;
    const cutoff = computeRetentionCutoff(years);

    const candidates = await Employee.find({
      tenantId: req.tenantId,
      status: 'Offboarded',
      offboardedAt: { $ne: null, $lte: cutoff },
      anonymizedAt: null,
    })
      .select('name email offboardedAt')
      .populate('departmentId', 'name')
      .sort({ offboardedAt: 1 });

    res.json({ success: true, data: { retentionYears: years, candidates } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/employees/:id/anonymize – HR only. Irreversible: scrubs personal
// data from the Employee record while leaving Payslip/Leave/Kpi documents
// that reference this _id untouched, since those carry their own statutory
// retention requirements (e.g. FIRS payroll records) independent of this
// person's data. Only ever runs on an already-Offboarded record — never
// touches anyone still active.
export const anonymizeEmployee = async (req, res) => {
  try {
    const emp = await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
    if (emp.status !== 'Offboarded')
      return res.status(400).json({ success: false, message: 'Only offboarded employees can be anonymized.' });
    if (emp.anonymizedAt)
      return res.status(400).json({ success: false, message: 'This record has already been anonymized.' });

    const anonymizedName = `Former Employee #${emp._id.toString().slice(-6).toUpperCase()}`;
    const originalName = emp.name;

    emp.name = anonymizedName;
    emp.email = `anonymized-${emp._id}@removed.invalid`;
    emp.phone = undefined;
    emp.nationality = undefined;
    emp.gender = undefined;
    emp.maritalStatus = undefined;
    emp.address = undefined;
    emp.dependants = [];
    emp.emergencyContacts = [];
    emp.education = [];
    emp.experience = [];
    emp.regulatory = undefined;
    emp.bankDetails = undefined;
    emp.password = undefined; // can never log in again
    emp.twoFactorEnabled = false;
    emp.twoFactorOtpHash = undefined;
    emp.resetPasswordToken = undefined;
    emp.privacyConsent = undefined;
    emp.anonymizedAt = new Date();

    await emp.save();

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: 'User' },
      targetType: 'Employee',
      targetId: emp._id,
      targetName: anonymizedName,
      changes: [{ field: 'Data retention', from: originalName, to: 'Anonymized per retention policy' }],
    });

    res.json({ success: true, message: 'Employee record anonymized.', data: { _id: emp._id, anonymizedAt: emp.anonymizedAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
