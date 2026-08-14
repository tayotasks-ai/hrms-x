import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import { sendEmail } from '../utils/email.js';
import { leaveRequested, leaveStatusUpdate } from '../utils/emailTemplates.js';

// Helper to format dates for emails
const fmtDate = (d) => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

const LEAVE_TYPES = ['Annual', 'Sick', 'Maternity', 'Paternity', 'Compassionate', 'Study', 'Unpaid', 'Emergency'];

// GET /api/leave-policy – any authenticated role (employees need to see their own entitlement)
export const getLeavePolicy = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('leavePolicy');
    res.json({ success: true, data: tenant?.leavePolicy || {} });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/leave-policy – HR only. Body: { Annual: 20, Sick: 12, ... }.
// A value of 0 means "no cap" for that leave type.
export const updateLeavePolicy = async (req, res) => {
  try {
    const updates = {};
    for (const type of LEAVE_TYPES) {
      if (req.body[type] === undefined) continue;
      const days = Number(req.body[type]);
      if (isNaN(days) || days < 0)
        return res.status(400).json({ success: false, message: `${type} must be a non-negative number of days.` });
      updates[`leavePolicy.${type}`] = days;
    }
    const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { $set: updates }, { new: true }).select('leavePolicy');
    res.json({ success: true, message: 'Leave policy updated.', data: tenant.leavePolicy });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Sums workingDays already committed (anything not Rejected — Pending counts
// too, so an employee can't stack several pending requests past their cap)
// for one employee/type within a calendar year.
const daysUsedInYear = async (tenantId, employeeId, type, year) => {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const records = await Leave.find({
    tenantId, employeeId, type,
    status: { $ne: 'Rejected' },
    startDate: { $gte: yearStart, $lte: yearEnd },
  }).select('workingDays');
  return records.reduce((sum, r) => sum + (r.workingDays || 0), 0);
};

// GET /api/leaves
export const getLeaves = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;

    const leaves = await Leave.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId', populate: { path: 'departmentId', select: 'name' } })
      .populate('reliefOfficer', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/leaves
export const createLeave = async (req, res) => {
  try {
    const tid = req.tenantId;
    let { employeeId, type, startDate, endDate, reason, reliefOfficer } = req.body;

    // Employees can only submit for themselves
    if (req.userRole === 'Employee') employeeId = req.user._id;
    if (!employeeId || !type || !startDate || !endDate)
      return res.status(400).json({ success: false, message: 'Employee, type, and dates are required.' });

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found in this organisation.' });

    // Count working days (Mon–Fri only, excluding Nigerian public holidays is configurable later)
    const start = new Date(startDate);
    const end = new Date(endDate);
    let workingDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) workingDays++;
    }

    // Hard-block requests that exceed the company's leave policy for this
    // type. A policy value of 0 (e.g. Unpaid by default) means no cap.
    const tenant = await Tenant.findById(tid).select('leavePolicy');
    const entitlement = tenant?.leavePolicy?.[type];
    if (entitlement > 0) {
      const year = start.getUTCFullYear();
      const used = await daysUsedInYear(tid, employeeId, type, year);
      const remaining = Math.max(entitlement - used, 0);
      if (workingDays > remaining) {
        return res.status(400).json({
          success: false,
          message: `This request (${workingDays} day${workingDays === 1 ? '' : 's'}) exceeds ${emp.name}'s remaining ${type} leave balance — ${remaining} of ${entitlement} day(s) left for ${year}.`,
        });
      }
    }

    const leave = await Leave.create({
      employeeId, tenantId: tid, type,
      startDate: start, endDate: end,
      workingDays, reason, reliefOfficer: reliefOfficer || null,
      status: 'Pending',
    });

    const populated = await Leave.findById(leave._id)
      .populate({ path: 'employeeId', select: 'name role departmentId', populate: { path: 'departmentId', select: 'name' } })
      .populate('reliefOfficer', 'name');

    // Fire-and-forget – notify HR admins
    User.find({ tenantId: tid, role: 'HR_Admin' }).select('email').lean()
      .then(admins => {
        const emails = admins.map(a => a.email).filter(Boolean);
        if (emails.length) {
          const tpl = leaveRequested({
            employeeName: emp.name, leaveType: type,
            startDate: fmtDate(start), endDate: fmtDate(end),
            workingDays, reason,
          });
          sendEmail({ to: emails, ...tpl }).catch(err => console.error('Email failed:', err.message));
        }
      })
      .catch(err => console.error('Email lookup failed:', err.message));

    res.status(201).json({ success: true, message: 'Leave request submitted.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/leaves/:id
export const updateLeaveStatus = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { status } = req.body;

    // Only HR can approve/reject
    if (req.userRole === 'Employee')
      return res.status(403).json({ success: false, message: 'Employees cannot approve or reject leaves.' });

    const validStatuses = ['Manager Approved', 'HR Approved', 'Rejected', 'Processed'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}.` });

    const leave = await Leave.findOne({ _id: req.params.id, tenantId: tid });
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found.' });

    leave.status = status;
    await leave.save();

    const populated = await Leave.findById(leave._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } })
      .populate('reliefOfficer', 'name');

    // Fire-and-forget – notify employee
    if (populated.employeeId?.email) {
      const tpl = leaveStatusUpdate({
        employeeName: populated.employeeId.name,
        leaveType: leave.type,
        startDate: fmtDate(leave.startDate),
        endDate: fmtDate(leave.endDate),
        status,
      });
      sendEmail({ to: populated.employeeId.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.json({ success: true, message: `Leave ${status.toLowerCase()}.`, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

