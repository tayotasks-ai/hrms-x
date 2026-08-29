import Tenant from '../models/Tenant.js';
import Payslip from '../models/Payslip.js';
import User from '../models/User.js';
import { getPlatformSecretKey } from '../utils/paystack.js';
import { payOnePayslip } from '../controllers/payslipPaymentController.js';
import { notifyHrAdmins } from '../utils/notify.js';

const isLastDayOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() === date.getDate();

const sameCalendarDay = (a, b) => a && new Date(a).toDateString() === new Date(b).toDateString();

// Pays every outstanding payslip for the current period, in a stable
// (employeeId) order, until the wallet runs out — "pay what it covers, skip
// the rest, notify HR" per the founders' decision on low-balance handling.
// Records recordAudit-compatible history by attributing the run to the
// tenant's longest-standing HR_Admin (audit entries require a real actor).
const runPayrollForTenant = async (tenant) => {
  const tid = tenant._id;

  const admin = await User.findOne({ tenantId: tid, role: 'HR_Admin' }).sort({ createdAt: 1 });
  if (!admin) {
    console.error(`Scheduled payroll: tenant ${tid} has no HR_Admin to attribute the run to — skipping.`);
    return;
  }

  let secretKey;
  try { secretKey = getPlatformSecretKey(); }
  catch (err) {
    console.error('Scheduled payroll: platform key not configured —', err.message);
    return;
  }

  const period = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const payslips = await Payslip.find({
    tenantId: tid,
    period,
    'payment.status': { $in: ['Unpaid', 'Failed'] },
  }).sort({ employeeId: 1 });

  await Tenant.updateOne({ _id: tid }, { 'payrollSchedule.lastRunAt': new Date() });

  if (payslips.length === 0) return;

  const actor = { id: admin._id, name: `${admin.name} (scheduled payroll)`, model: 'User' };
  const isTestAccount = !!tenant.isTestAccount;
  const tenantName = tenant.name || '';
  const results = [];
  for (const payslip of payslips) {
    results.push(await payOnePayslip(payslip, secretKey, tid, actor, { isTestAccount, tenantName }));
  }

  const succeeded = results.filter(r => r.ok).length;
  const short = results.filter(r => r.insufficientBalance);
  const shortfall = short.reduce((sum, r) => sum + (r.shortfall || 0), 0);

  notifyHrAdmins(User, tid, {
    type: 'scheduled_payroll_run',
    title: 'Scheduled payroll run completed',
    message: `${succeeded} of ${results.length} payslip(s) paid for ${period}.`
      + (short.length ? ` ${short.length} skipped — wallet was short by about ₦${shortfall.toLocaleString()}. Top up and pay the rest from Payroll.` : ''),
    link: 'payroll',
  });
};

// Registers the recurring check on the given Agenda instance and schedules
// it. Call once at server startup, after agenda.start(). Runs once a day —
// each run only actually pays anyone for tenants whose payday matches today
// and haven't already run today (lastRunAt guard), so it's safe to define
// as a single shared daily job rather than one job per tenant.
export const startPayrollScheduler = (agenda) => {
  agenda.define('run-tenant-payroll-check', async () => {
    const today = new Date();
    const lastDay = isLastDayOfMonth(today);

    const tenants = await Tenant.find({ 'payrollSchedule.active': true })
      .select('payrollSchedule isTestAccount name');

    for (const tenant of tenants) {
      const sched = tenant.payrollSchedule;
      const matchesDay = sched.useLastDayOfMonth ? lastDay : sched.dayOfMonth === today.getDate();
      if (!matchesDay) continue;
      if (sameCalendarDay(sched.lastRunAt, today)) continue; // already ran today

      try {
        await runPayrollForTenant(tenant);
      } catch (err) {
        console.error(`Scheduled payroll run failed for tenant ${tenant._id}:`, err.message);
      }
    }
  });

  // 07:00 server time, daily. See jobs/agenda.js for the caveat about hosts
  // that spin down when idle.
  agenda.every('0 7 * * *', 'run-tenant-payroll-check');
};
