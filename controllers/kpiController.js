import Kpi from '../models/Kpi.js';
import Employee from '../models/Employee.js';
import PerformanceCycle from '../models/PerformanceCycle.js';
import User from '../models/User.js';
import { sendEmail } from '../utils/email.js';
import { kpiSelfReviewSubmitted, kpiSignedOff } from '../utils/emailTemplates.js';

// Notify whoever needs to act next on a KPI review. Falls back to notifying
// every HR Admin for the tenant when the employee has no manager set (e.g.
// department heads), since submitManagerReview already lets HR sign off in
// that case.
const notifyNextReviewer = async (tid, employee, tpl) => {
  if (employee?.managerId) {
    const manager = await Employee.findOne({ _id: employee.managerId, tenantId: tid });
    if (manager?.email) {
      return sendEmail({ to: manager.email, ...tpl(manager.name) }).catch(err => console.error('Email failed:', err.message));
    }
  }
  const hrAdmins = await User.find({ tenantId: tid, role: 'HR_Admin' }).select('name email');
  await Promise.all(
    hrAdmins.filter(a => a.email).map(a => sendEmail({ to: a.email, ...tpl(a.name) }).catch(err => console.error('Email failed:', err.message)))
  );
};

// GET /api/kpis
export const getKpis = async (req, res) => {
  try {
    const tid = req.tenantId;
    let query = { tenantId: tid };
    
    if (req.userRole === 'Employee') {
      // Find direct reports
      const directReports = await Employee.find({ managerId: req.user._id, tenantId: tid }).select('_id');
      const directReportIds = directReports.map(emp => emp._id);
      
      query.employeeId = { $in: [req.user._id, ...directReportIds] };
    }

    const kpis = await Kpi.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId managerId', populate: { path: 'departmentId', select: 'name' } })
      .populate('cycleId', 'name status')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: kpis });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/kpis
export const createKpi = async (req, res) => {
  try {
    const tid = req.tenantId;
    let { employeeId, cycleId } = req.body;
    
    if (!cycleId) {
      return res.status(400).json({ success: false, message: 'Performance Cycle is required.' });
    }

    const cycle = await PerformanceCycle.findOne({ _id: cycleId, tenantId: tid });
    if (!cycle) {
      return res.status(404).json({ success: false, message: 'Performance Cycle not found.' });
    }
    if (cycle.status !== 'Open') {
      return res.status(400).json({ success: false, message: 'KPIs can only be assigned during an Open Performance Cycle.' });
    }
    
    if (req.userRole === 'Employee' && employeeId !== req.user._id.toString()) {
      // Allow if the target employee reports to this user
      const targetEmp = await Employee.findOne({ _id: employeeId, tenantId: tid });
      if (!targetEmp || targetEmp.managerId?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized to assign KPIs to this employee.' });
      }
    } else if (req.userRole === 'Employee') {
      employeeId = req.user._id;
    }

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const kpi = await Kpi.create({ ...req.body, employeeId, tenantId: tid });
    const populated = await Kpi.findById(kpi._id)
      .populate({ path: 'employeeId', select: 'name role departmentId managerId', populate: { path: 'departmentId', select: 'name' } })
      .populate('cycleId', 'name status');
    res.status(201).json({ success: true, message: 'KPI created.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/kpis/:id/self-review  – KPI owner submits their self-assessment
export const submitSelfReview = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5)
      return res.status(400).json({ success: false, message: 'Score must be between 1 and 5.' });

    const kpi = await Kpi.findOne({ _id: req.params.id, tenantId: tid });
    if (!kpi) return res.status(404).json({ success: false, message: 'KPI not found.' });

    if (req.userRole === 'Employee' && kpi.employeeId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, message: 'Only the KPI owner can submit a self-review.' });

    if (kpi.reviewStage !== 'Pending Self-Review')
      return res.status(400).json({ success: false, message: `Self-review already submitted (stage: ${kpi.reviewStage}).` });

    kpi.selfRating = { score, comment, submittedAt: new Date() };
    kpi.reviewStage = 'Pending Manager-Review';
    await kpi.save();

    const populated = await Kpi.findById(kpi._id)
      .populate({ path: 'employeeId', select: 'name role departmentId managerId', populate: { path: 'departmentId', select: 'name' } })
      .populate('cycleId', 'name status');

    // Fire-and-forget – tell whoever needs to sign this off
    notifyNextReviewer(tid, populated.employeeId, (recipientName) => kpiSelfReviewSubmitted({
      managerName: recipientName,
      employeeName: populated.employeeId?.name || 'An employee',
      kpiTitle: populated.title,
      score,
    })).catch(err => console.error('KPI notify failed:', err.message));

    res.json({ success: true, message: 'Self-review submitted.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/kpis/:id/manager-review  – employee's manager or HR signs off
export const submitManagerReview = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5)
      return res.status(400).json({ success: false, message: 'Score must be between 1 and 5.' });

    const kpi = await Kpi.findOne({ _id: req.params.id, tenantId: tid });
    if (!kpi) return res.status(404).json({ success: false, message: 'KPI not found.' });

    if (kpi.reviewStage !== 'Pending Manager-Review')
      return res.status(400).json({ success: false, message: `Not awaiting manager review (stage: ${kpi.reviewStage}).` });

    if (req.userRole === 'Employee') {
      const targetEmp = await Employee.findOne({ _id: kpi.employeeId, tenantId: tid });
      if (!targetEmp || targetEmp.managerId?.toString() !== req.user._id.toString())
        return res.status(403).json({ success: false, message: 'Only the employee\'s manager or HR can submit a manager review.' });
    }

    kpi.managerRating = {
      score, comment, submittedAt: new Date(),
      ratedBy: req.user._id,
      ratedByModel: req.userRole === 'Employee' ? 'Employee' : 'User'
    };
    kpi.finalScore = score;
    kpi.reviewStage = 'Signed Off';
    await kpi.save();

    const populated = await Kpi.findById(kpi._id)
      .populate({ path: 'employeeId', select: 'name role departmentId managerId email', populate: { path: 'departmentId', select: 'name' } })
      .populate('cycleId', 'name status');

    // Fire-and-forget – let the employee know their KPI was signed off
    if (populated.employeeId?.email) {
      const tpl = kpiSignedOff({
        employeeName: populated.employeeId.name,
        kpiTitle: populated.title,
        finalScore: score,
      });
      sendEmail({ to: populated.employeeId.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.json({ success: true, message: 'Manager review submitted. KPI signed off.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/kpis/summary?cycleId=...  – per-employee weighted overall rating for a cycle
export const getKpiSummary = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { cycleId } = req.query;
    if (!cycleId) return res.status(400).json({ success: false, message: 'cycleId is required.' });

    const kpis = await Kpi.find({ tenantId: tid, cycleId })
      .populate({ path: 'employeeId', select: 'name role departmentId managerId', populate: { path: 'departmentId', select: 'name' } });

    const byEmployee = {};
    for (const kpi of kpis) {
      const empId = kpi.employeeId?._id?.toString();
      if (!empId) continue;
      if (!byEmployee[empId]) {
        byEmployee[empId] = {
          employee: kpi.employeeId,
          totalKpis: 0,
          signedOffKpis: 0,
          pendingKpis: 0,
          weightedScoreSum: 0,
          weightSum: 0
        };
      }
      const bucket = byEmployee[empId];
      bucket.totalKpis += 1;
      if (kpi.reviewStage === 'Signed Off') {
        bucket.signedOffKpis += 1;
        const w = kpi.weight ?? (100 / kpis.filter(k => k.employeeId?._id?.toString() === empId).length);
        bucket.weightedScoreSum += kpi.finalScore * w;
        bucket.weightSum += w;
      } else {
        bucket.pendingKpis += 1;
      }
    }

    const summary = Object.values(byEmployee).map(b => ({
      employee: b.employee,
      totalKpis: b.totalKpis,
      signedOffKpis: b.signedOffKpis,
      pendingKpis: b.pendingKpis,
      overallRating: b.weightSum > 0 ? Math.round((b.weightedScoreSum / b.weightSum) * 10) / 10 : null
    }));

    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/kpis/:id  – update self-rating or manager rating
export const updateKpi = async (req, res) => {
  try {
    const tid = req.tenantId;
    let query = { _id: req.params.id, tenantId: tid };
    
    if (req.userRole === 'Employee') {
      const directReports = await Employee.find({ managerId: req.user._id, tenantId: tid }).select('_id');
      const directReportIds = directReports.map(emp => emp._id);
      query.employeeId = { $in: [req.user._id, ...directReportIds] };
    }

    const kpi = await Kpi.findOneAndUpdate(query, req.body, { new: true })
      .populate({ path: 'employeeId', select: 'name role departmentId managerId', populate: { path: 'departmentId', select: 'name' } });
    if (!kpi) return res.status(404).json({ success: false, message: 'KPI not found or unauthorized.' });
    res.json({ success: true, message: 'KPI updated.', data: kpi });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
