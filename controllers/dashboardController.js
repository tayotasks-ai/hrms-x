import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';
import Payslip from '../models/Payslip.js';
import Probation from '../models/Probation.js';
import HelpdeskTicket from '../models/HelpdeskTicket.js';
import Requisition from '../models/Requisition.js';
import Onboarding from '../models/Onboarding.js';
import Tenant from '../models/Tenant.js';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '—';

// Birthdays and work anniversaries falling in the current calendar month,
// for the "Upcoming Milestones" panel. Matches on month/day only (not
// year), so this naturally recurs every year without any stored state.
// Anniversaries only count once the join year has passed (years >= 1).
export const buildMonthlyMilestones = (employees, today) => {
  const month = today.getMonth();
  const items = [];

  employees.forEach((e) => {
    if (e.birthDate) {
      const bd = new Date(e.birthDate);
      if (bd.getMonth() === month) {
        items.push({ type: 'Birthday', name: e.name, role: e.role, date: bd.getDate(), detail: 'Birthday' });
      }
    }
    if (e.joinDate) {
      const jd = new Date(e.joinDate);
      if (jd.getMonth() === month && jd.getFullYear() < today.getFullYear()) {
        const years = today.getFullYear() - jd.getFullYear();
        items.push({ type: 'Anniversary', name: e.name, role: e.role, date: jd.getDate(), detail: `${years} year${years === 1 ? '' : 's'}` });
      }
    }
  });

  return items.sort((a, b) => a.date - b.date);
};

// Builds the "Action Inbox": every record across existing modules that is
// actually waiting on this HR admin, ranked by how long it's been waiting.
const buildActionInbox = async (tid) => {
  const now = Date.now();
  const soon = new Date(now + 2 * 24 * 60 * 60 * 1000);

  const [pendingLeaves, pendingRequisitions, probationsDue, onboardingRecords] = await Promise.all([
    Leave.find({ tenantId: tid, status: 'Pending' }).populate('employeeId', 'name').sort({ createdAt: 1 }),
    Requisition.find({ tenantId: tid, status: 'Pending' }).populate('employeeId', 'name').sort({ createdAt: 1 }),
    Probation.find({
      tenantId: tid, status: 'Active',
      endDate: { $lte: new Date(now + 14 * 24 * 60 * 60 * 1000) },
    }).populate('employeeId', 'name'),
    Onboarding.find({ tenantId: tid, stage: { $ne: 'Completed' } }).populate('employeeId', 'name'),
  ]);

  const items = [];

  pendingLeaves.forEach((l) => {
    items.push({
      type: 'leave',
      id: l._id,
      title: `${l.employeeId?.name || 'Employee'} — ${l.type} leave`,
      subtitle: `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`,
      staleDays: Math.floor((now - new Date(l.createdAt)) / 86400000),
      tab: 'leaves',
    });
  });

  pendingRequisitions.forEach((r) => {
    items.push({
      type: 'requisition',
      id: r._id,
      title: `${r.employeeId?.name || 'Employee'} — requisition`,
      subtitle: (r.description || '').slice(0, 60),
      staleDays: Math.floor((now - new Date(r.createdAt)) / 86400000),
      tab: 'requisitions',
    });
  });

  probationsDue.forEach((p) => {
    const daysLeft = Math.ceil((new Date(p.endDate) - now) / 86400000);
    items.push({
      type: 'probation',
      id: p._id,
      title: `${p.employeeId?.name || 'Employee'} — probation ending`,
      subtitle: daysLeft <= 0 ? 'Ended — needs a decision' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
      staleDays: daysLeft <= 0 ? 999 : 0,
      tab: 'probation',
    });
  });

  onboardingRecords.forEach((o) => {
    (o.tasks || []).forEach((t) => {
      if (t.status !== 'Completed' && t.dueDate && new Date(t.dueDate) <= soon) {
        items.push({
          type: 'onboarding',
          id: `${o._id}-${t._id}`,
          title: `${o.employeeId?.name || 'Employee'} — ${t.title}`,
          subtitle: `Due ${fmtDate(t.dueDate)}`,
          staleDays: new Date(t.dueDate) < now ? 999 : 0,
          tab: 'onboarding',
        });
      }
    });
  });

  return items.sort((a, b) => b.staleDays - a.staleDays);
};

// GET /api/dashboard/stats
// Returns different payloads depending on role
export const getDashboardStats = async (req, res) => {
  try {
    const tid = req.tenantId;

    if (req.userRole === 'Employee') {
      // ── ESS dashboard data ─────────────────────────────────────────────────
      const empId = req.user._id;
      const currentYear = new Date().getUTCFullYear();
      const yearStart = new Date(Date.UTC(currentYear, 0, 1));
      const yearEnd = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));

      const [myLeaves, myPayslips, myProbation, myTickets, tenant, leavesThisYear] = await Promise.all([
        Leave.find({ tenantId: tid, employeeId: empId }).sort({ createdAt: -1 }).limit(5),
        Payslip.find({ tenantId: tid, employeeId: empId }).sort({ period: -1 }).limit(1),
        Probation.findOne({ tenantId: tid, employeeId: empId, status: 'Active' }),
        HelpdeskTicket.countDocuments({ tenantId: tid, employeeId: empId, status: { $in: ['Open', 'In Progress'] } }),
        Tenant.findById(tid).select('leavePolicy'),
        // One query for every type this year, then grouped in JS below —
        // mirrors leaveController.daysUsedInYear: anything not Rejected
        // counts (Pending included, so a stacked request can't hide used days).
        Leave.find({
          tenantId: tid, employeeId: empId,
          status: { $ne: 'Rejected' },
          startDate: { $gte: yearStart, $lte: yearEnd },
        }).select('type workingDays'),
      ]);

      const pendingLeaves = myLeaves.filter(l => l.status === 'Pending').length;
      const approvedLeaves = myLeaves.filter(l => ['HR Approved', 'Manager Approved'].includes(l.status)).length;

      const usedByType = {};
      leavesThisYear.forEach(l => { usedByType[l.type] = (usedByType[l.type] || 0) + (l.workingDays || 0); });

      // Fixed order matching the Tenant schema's leavePolicy fields, so the
      // dashboard list renders in a stable, sensible order every time.
      const LEAVE_TYPES = ['Annual', 'Sick', 'Maternity', 'Paternity', 'Compassionate', 'Study', 'Unpaid', 'Emergency'];
      const leaveBalances = LEAVE_TYPES.map((type) => {
        const entitlement = tenant?.leavePolicy?.[type] ?? 0;
        const used = usedByType[type] || 0;
        return entitlement > 0
          ? { type, entitlement, used, remaining: Math.max(entitlement - used, 0), uncapped: false }
          : { type, entitlement, used, remaining: null, uncapped: true };
      });

      return res.json({
        success: true,
        data: {
          role: 'Employee',
          recentLeaves: myLeaves,
          latestPayslip: myPayslips[0] || null,
          activeProbation: myProbation || null,
          openTickets: myTickets,
          pendingLeaves,
          approvedLeaves,
          leaveBalances,
        },
      });
    }

    // ── HR Admin dashboard data ────────────────────────────────────────────────
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [
      totalEmployees,
      activeLeaves,
      newHiresThisMonth,
      pendingLeaves,
      probationsExpiringSoon,
      openTickets,
      activeEmployees,
      milestoneEmployees,
      departmentBreakdown,
      actionInbox,
    ] = await Promise.all([
      Employee.countDocuments({ tenantId: tid, status: { $ne: 'Offboarded' } }),
      Leave.countDocuments({ tenantId: tid, status: { $in: ['Manager Approved', 'HR Approved'] } }),
      Employee.countDocuments({ tenantId: tid, joinDate: { $gte: monthStart, $lte: monthEnd } }),
      Leave.countDocuments({ tenantId: tid, status: 'Pending' }),
      Probation.countDocuments({
        tenantId: tid,
        status: 'Active',
        endDate: { $lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
      }),
      HelpdeskTicket.countDocuments({ tenantId: tid, status: { $in: ['Open', 'In Progress'] } }),
      Employee.find({ tenantId: tid, status: { $in: ['Active', 'Onboarding'] } }).select('salary'),
      Employee.find({ tenantId: tid, status: { $ne: 'Offboarded' } }).select('name role birthDate joinDate'),
      Employee.aggregate([
        { $match: { tenantId: tid, status: { $ne: 'Offboarded' } } },
        { $lookup: { from: 'departments', localField: 'departmentId', foreignField: '_id', as: 'dept' } },
        { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$dept.name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      buildActionInbox(tid),
    ]);

    const monthlyPayroll = activeEmployees.reduce((sum, e) => sum + (e.salary || 0), 0);
    const milestones = buildMonthlyMilestones(milestoneEmployees, today);

    res.json({
      success: true,
      data: {
        role: 'HR_Admin',
        currentMonth: today.toLocaleString('default', { month: 'long', year: 'numeric' }),
        totalEmployees,
        monthlyPayroll,
        activeLeaves,
        newHiresThisMonth,
        pendingLeaves,
        probationsExpiringSoon,
        openTickets,
        departmentBreakdown: departmentBreakdown.reduce((acc, d) => {
          acc[d._id || 'Unknown'] = d.count;
          return acc;
        }, {}),
        actionInbox,
        milestones,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
