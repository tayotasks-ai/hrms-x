import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import { sendEmail } from '../utils/email.js';
import { leaveRequested, leaveStatusUpdate } from '../utils/emailTemplates.js';
import { isNigerianPublicHoliday } from '../utils/nigerianHolidays.js';
import { notify, notifyHrAdmins } from '../utils/notify.js';

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

// PUT /api/leave-policy – HR only. Body: { Annual: 20, Sick: 12, ..., requireReliefOfficer: true }.
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
    if (req.body.requireReliefOfficer !== undefined) {
      updates['leavePolicy.requireReliefOfficer'] = !!req.body.requireReliefOfficer;
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

// GET /api/leaves — employees see their own requests, plus anything from
// people who report directly to them (needed for the manager-approval step),
// plus anything where they're the assigned relief officer (needed for that
// step — see updateLeaveStatus below).
export const getLeaves = async (req, res) => {
  try {
    const tid = req.tenantId;
    let query = { tenantId: tid };
    if (req.userRole === 'Employee') {
      const directReports = await Employee.find({ tenantId: tid, managerId: req.user._id }).select('_id');
      const reportIds = directReports.map(e => e._id);
      query = {
        tenantId: tid,
        $or: [
          { employeeId: { $in: [req.user._id, ...reportIds] } },
          { reliefOfficer: req.user._id },
        ],
      };
    }

    const leaves = await Leave.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId managerId', populate: { path: 'departmentId', select: 'name' } })
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

    // Count working days: Mon–Fri, excluding Nigerian federal public
    // holidays (fixed-date + Easter-derived — see utils/nigerianHolidays.js
    // for the Islamic-holiday caveat).
    const start = new Date(startDate);
    const end = new Date(endDate);
    let workingDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6 && !isNigerianPublicHoliday(d)) workingDays++;
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

    // Relief officer — the peer who covers this employee's duties while
    // they're out. Optional unless the tenant has turned on
    // requireReliefOfficer (see leavePolicy on Tenant), in which case it's
    // mandatory and gates the approval chain (see updateLeaveStatus below).
    // Whenever one is provided, it must be a same-tenant, same-department
    // colleague other than the requester themselves.
    const requireRelief = !!tenant?.leavePolicy?.requireReliefOfficer;
    if (requireRelief && !reliefOfficer) {
      return res.status(400).json({ success: false, message: 'A relief officer is required for leave requests at this organisation.' });
    }
    let reliefOfficerEmp = null;
    if (reliefOfficer) {
      reliefOfficerEmp = await Employee.findOne({ _id: reliefOfficer, tenantId: tid });
      if (!reliefOfficerEmp)
        return res.status(404).json({ success: false, message: 'Relief officer not found in this organisation.' });
      if (reliefOfficerEmp._id.toString() === emp._id.toString())
        return res.status(400).json({ success: false, message: 'The relief officer must be a different employee.' });
      if (String(reliefOfficerEmp.departmentId || '') !== String(emp.departmentId || ''))
        return res.status(400).json({ success: false, message: 'The relief officer must be in the same department.' });
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

    // Fire-and-forget – notify whoever acts first. If a relief officer step
    // is in play (required by policy and one was picked), they go first;
    // otherwise this falls back to the original manager-then-HR routing.
    const notifTitle = 'New leave request';
    const notifMessage = `${emp.name} requested ${workingDays} day(s) of ${type} leave (${fmtDate(start)} – ${fmtDate(end)}).`;
    if (requireRelief && reliefOfficerEmp) {
      notify({ tenantId: tid, recipientId: reliefOfficerEmp._id, recipientModel: 'Employee', type: 'leave', title: `You're the relief officer for ${emp.name}'s leave request`, message: notifMessage, link: 'leaves' });
      if (reliefOfficerEmp.email) {
        const tpl = leaveRequested({ employeeName: emp.name, leaveType: type, startDate: fmtDate(start), endDate: fmtDate(end), workingDays, reason });
        sendEmail({ to: reliefOfficerEmp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
      }
    } else if (emp.managerId) {
      Employee.findOne({ _id: emp.managerId, tenantId: tid }).select('name email')
        .then(manager => {
          if (!manager) return;
          notify({ tenantId: tid, recipientId: manager._id, recipientModel: 'Employee', type: 'leave', title: notifTitle, message: notifMessage, link: 'leaves' });
          if (manager.email) {
            const tpl = leaveRequested({ employeeName: emp.name, leaveType: type, startDate: fmtDate(start), endDate: fmtDate(end), workingDays, reason });
            sendEmail({ to: manager.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
          }
        })
        .catch(err => console.error('Manager lookup failed:', err.message));
    } else {
      notifyHrAdmins(User, tid, { type: 'leave', title: notifTitle, message: notifMessage, link: 'leaves' });
      User.find({ tenantId: tid, role: 'HR_Admin' }).select('email').lean()
        .then(admins => {
          const emails = admins.map(a => a.email).filter(Boolean);
          if (emails.length) {
            const tpl = leaveRequested({ employeeName: emp.name, leaveType: type, startDate: fmtDate(start), endDate: fmtDate(end), workingDays, reason });
            sendEmail({ to: emails, ...tpl }).catch(err => console.error('Email failed:', err.message));
          }
        })
        .catch(err => console.error('Email lookup failed:', err.message));
    }

    res.status(201).json({ success: true, message: 'Leave request submitted.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/leaves/:id
// Up to three-step approval: an optional relief officer sign-off first
// (Pending -> Relief Officer Approved) — only in play when the tenant has
// requireReliefOfficer on AND this request actually has one assigned — then
// the employee's direct manager (-> Manager Approved), then HR's final
// sign-off (-> HR Approved -> Processed). If the employee has no manager,
// HR can approve directly from whatever step it's at — same fallback
// pattern as the KPI review chain. Reject is allowed from any pre-HR-
// approval step, by whoever holds that step (relief officer, manager) or HR.
export const updateLeaveStatus = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { status } = req.body;
    const isHR = req.userRole !== 'Employee';

    const validStatuses = ['Relief Officer Approved', 'Manager Approved', 'HR Approved', 'Rejected', 'Processed'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}.` });

    const leave = await Leave.findOne({ _id: req.params.id, tenantId: tid });
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found.' });

    const emp = await Employee.findOne({ _id: leave.employeeId, tenantId: tid });
    const isManager = !isHR && emp?.managerId?.toString() === req.user._id.toString();
    const isReliefOfficer = !isHR && leave.reliefOfficer?.toString() === req.user._id.toString();

    if (!isHR && !isManager && !isReliefOfficer)
      return res.status(403).json({ success: false, message: "Only the employee's relief officer, manager, or HR can update this leave request." });

    const tenant = await Tenant.findById(tid).select('leavePolicy');
    // The relief-officer step only actually gates the chain if the tenant
    // has turned it on AND this specific request has one assigned — a
    // request with no relief officer (or a tenant that never required one)
    // skips straight to the manager step, same as always.
    const reliefGates = !!tenant?.leavePolicy?.requireReliefOfficer && !!leave.reliefOfficer;

    if (status === 'Relief Officer Approved') {
      if (!isReliefOfficer && !isHR)
        return res.status(403).json({ success: false, message: 'Only the assigned relief officer or HR can give this approval.' });
      if (leave.status !== 'Pending')
        return res.status(400).json({ success: false, message: `Cannot give relief officer approval from status "${leave.status}".` });
    } else if (status === 'Manager Approved') {
      if (!isManager && !isHR)
        return res.status(403).json({ success: false, message: "Only the employee's manager or HR can give this approval." });
      const allowedFrom = reliefGates ? ['Relief Officer Approved'] : ['Pending'];
      if (!allowedFrom.includes(leave.status))
        return res.status(400).json({ success: false, message: reliefGates ? `This request needs relief officer approval first (currently "${leave.status}").` : `Cannot give manager approval from status "${leave.status}".` });
    } else if (status === 'HR Approved') {
      if (!isHR) return res.status(403).json({ success: false, message: 'Only HR can give final approval.' });
      const allowedFrom = emp?.managerId ? ['Manager Approved'] : ['Pending', 'Relief Officer Approved', 'Manager Approved'];
      if (!allowedFrom.includes(leave.status))
        return res.status(400).json({ success: false, message: `This request needs manager approval first (currently "${leave.status}").` });
    } else if (status === 'Processed') {
      if (!isHR) return res.status(403).json({ success: false, message: 'Only HR can mark a leave as processed.' });
      if (leave.status !== 'HR Approved')
        return res.status(400).json({ success: false, message: `Cannot mark processed from status "${leave.status}".` });
    } else if (status === 'Rejected') {
      if (!['Pending', 'Relief Officer Approved', 'Manager Approved'].includes(leave.status))
        return res.status(400).json({ success: false, message: `Cannot reject from status "${leave.status}".` });
    }

    leave.status = status;
    await leave.save();

    const populated = await Leave.findById(leave._id)
      .populate({ path: 'employeeId', select: 'name role departmentId managerId email', populate: { path: 'departmentId', select: 'name' } })
      .populate('reliefOfficer', 'name');

    // Fire-and-forget – notify whoever needs to know next
    if (status === 'Relief Officer Approved') {
      // Tell the manager it's ready for their sign-off, or HR if there's no manager
      const notifTitle = 'Leave ready for manager approval';
      const notifMessage = `${populated.employeeId?.name || 'An employee'}'s ${leave.type} leave was approved by their relief officer and needs your sign-off.`;
      if (emp?.managerId) {
        Employee.findOne({ _id: emp.managerId, tenantId: tid }).select('name email')
          .then(manager => {
            if (!manager) return;
            notify({ tenantId: tid, recipientId: manager._id, recipientModel: 'Employee', type: 'leave', link: 'leaves', title: notifTitle, message: notifMessage });
          })
          .catch(err => console.error('Manager lookup failed:', err.message));
      } else {
        notifyHrAdmins(User, tid, { type: 'leave', link: 'leaves', title: notifTitle, message: notifMessage });
      }
    } else if (status === 'Manager Approved') {
      // Tell HR it's ready for final sign-off
      notifyHrAdmins(User, tid, {
        type: 'leave', link: 'leaves',
        title: 'Leave ready for HR approval',
        message: `${populated.employeeId?.name || 'An employee'}'s ${leave.type} leave was approved by their manager and needs final HR sign-off.`,
      });
    } else if (populated.employeeId) {
      // Any other transition (HR Approved, Rejected, Processed) — tell the employee
      notify({
        tenantId: tid, recipientId: populated.employeeId._id, recipientModel: 'Employee',
        type: 'leave', link: 'leaves',
        title: `Leave request ${status.toLowerCase()}`,
        message: `Your ${leave.type} leave (${fmtDate(leave.startDate)} – ${fmtDate(leave.endDate)}) is now "${status}".`,
      });
    }

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

