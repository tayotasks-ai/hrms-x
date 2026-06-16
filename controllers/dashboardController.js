import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';
import Payslip from '../models/Payslip.js';
import Probation from '../models/Probation.js';
import HelpdeskTicket from '../models/HelpdeskTicket.js';

// GET /api/dashboard/stats
// Returns different payloads depending on role
export const getDashboardStats = async (req, res) => {
  try {
    const tid = req.tenantId;

    if (req.userRole === 'Employee') {
      // ── ESS dashboard data ─────────────────────────────────────────────────
      const empId = req.user._id;

      const [myLeaves, myPayslips, myProbation, myTickets] = await Promise.all([
        Leave.find({ tenantId: tid, employeeId: empId }).sort({ createdAt: -1 }).limit(5),
        Payslip.find({ tenantId: tid, employeeId: empId }).sort({ period: -1 }).limit(1),
        Probation.findOne({ tenantId: tid, employeeId: empId, status: 'Active' }),
        HelpdeskTicket.countDocuments({ tenantId: tid, employeeId: empId, status: { $in: ['Open', 'In Progress'] } }),
      ]);

      const pendingLeaves = myLeaves.filter(l => l.status === 'Pending').length;
      const approvedLeaves = myLeaves.filter(l => ['HR Approved', 'Manager Approved'].includes(l.status)).length;

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
      departmentBreakdown,
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
      Employee.aggregate([
        { $match: { tenantId: tid, status: { $ne: 'Offboarded' } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const monthlyPayroll = activeEmployees.reduce((sum, e) => sum + (e.salary || 0), 0);

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
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
