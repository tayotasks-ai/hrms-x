import Probation from '../models/Probation.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { probationOutcome } from '../utils/emailTemplates.js';

// GET /api/probation
export const getProbations = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;

    const records = await Probation.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } })
      .populate('outcomes.decidedBy', 'name')
      .sort({ endDate: 1 });

    // Attach daysRemaining helper
    const now = Date.now();
    const data = records.map(r => {
      const obj = r.toObject();
      obj.daysRemaining = r.status === 'Active'
        ? Math.max(0, Math.ceil((new Date(r.endDate) - now) / 86400000))
        : null;
      return obj;
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/probation  – HR creates probation for employee
export const createProbation = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { employeeId, startDate, endDate } = req.body;
    if (!employeeId || !startDate || !endDate)
      return res.status(400).json({ success: false, message: 'employeeId, startDate, and endDate are required.' });

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const existing = await Probation.findOne({ employeeId, tenantId: tid, status: 'Active' });
    if (existing) return res.status(409).json({ success: false, message: 'Active probation already exists for this employee.' });

    const record = await Probation.create({ employeeId, tenantId: tid, startDate, endDate });
    const populated = await Probation.findById(record._id).populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } });
    res.status(201).json({ success: true, message: 'Probation created.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/probation/:id/outcome  – HR records outcome
export const recordOutcome = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { decision, reason, newEndDate } = req.body;
    const validDecisions = ['Confirm', 'Extend', 'Terminate'];
    if (!validDecisions.includes(decision))
      return res.status(400).json({ success: false, message: `Decision must be: ${validDecisions.join(', ')}.` });

    const record = await Probation.findOne({ _id: req.params.id, tenantId: tid });
    if (!record) return res.status(404).json({ success: false, message: 'Probation record not found.' });

    // Apply outcome
    if (decision === 'Confirm') {
      record.status = 'Confirmed';
    } else if (decision === 'Extend') {
      if (!newEndDate) return res.status(400).json({ success: false, message: 'newEndDate is required for extension.' });
      record.extensionCount += 1;
      record.endDate = new Date(newEndDate);
    } else {
      record.status = 'Terminated';
    }

    record.outcomes.push({ decision, reason, newEndDate: newEndDate ? new Date(newEndDate) : undefined, decidedBy: req.user._id });
    await record.save();

    const populated = await Probation.findById(record._id).populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } });

    // Fire-and-forget – notify employee
    if (populated.employeeId?.email) {
      const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined;
      const tpl = probationOutcome({
        employeeName: populated.employeeId.name,
        decision,
        reason,
        newEndDate: newEndDate ? fmtDate(newEndDate) : undefined,
      });
      sendEmail({ to: populated.employeeId.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.json({ success: true, message: `Probation ${decision.toLowerCase()}ed.`, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
