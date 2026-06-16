import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import { sendEmail } from '../utils/email.js';
import { leaveRequested, leaveStatusUpdate } from '../utils/emailTemplates.js';

// Helper to format dates for emails
const fmtDate = (d) => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

// GET /api/leaves
export const getLeaves = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;

    const leaves = await Leave.find(query)
      .populate('employeeId', 'name role department')
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

    const leave = await Leave.create({
      employeeId, tenantId: tid, type,
      startDate: start, endDate: end,
      workingDays, reason, reliefOfficer: reliefOfficer || null,
      status: 'Pending',
    });

    const populated = await Leave.findById(leave._id)
      .populate('employeeId', 'name role department')
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
      .populate('employeeId', 'name role department email')
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

