import Payslip from '../models/Payslip.js';
import Employee from '../models/Employee.js';
import Tenant from '../models/Tenant.js';
import { sendEmail } from '../utils/email.js';
import { payslipAvailable } from '../utils/emailTemplates.js';
import { calculateNigerianPayroll } from '../utils/payrollCalc.js';
import { streamPayslipPdf } from '../utils/payslipPdf.js';
import { notify } from '../utils/notify.js';
import { decryptRegulatoryField } from '../utils/piiDisplay.js';

// GET /api/payslips  – employees only see their own
export const getPayslips = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;

    const payslips = await Payslip.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } })
      .sort({ period: -1, createdAt: -1 });

    res.json({ success: true, data: payslips });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payslips  – HR only
// PAYE/pension/NHF are computed automatically per the Nigeria Tax Act 2025
// (see utils/payrollCalc.js). `otherDeductions` covers anything outside that,
// e.g. loan repayments or union dues, entered manually by HR.
export const createPayslip = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { employeeId, period, basicSalary, allowances, otherDeductions, payslipType } = req.body;
    if (!employeeId || !period || basicSalary === undefined)
      return res.status(400).json({ success: false, message: 'employeeId, period, and basicSalary are required.' });

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const { grossPay, deductions, netPay } = calculateNigerianPayroll({
      basicSalary, allowances, otherDeductions,
    });

    const payslip = await Payslip.create({
      employeeId, tenantId: tid, period,
      basicSalary, allowances: allowances || 0,
      deductions,
      grossPay, netPay,
      payslipType: payslipType || 'Regular',
      status: 'Paid',
    });

    const populated = await Payslip.findById(payslip._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } });

    // Fire-and-forget – notify employee
    notify({
      tenantId: tid, recipientId: emp._id, recipientModel: 'Employee',
      type: 'payslip', link: 'payroll',
      title: 'New payslip available',
      message: `Your payslip for ${period} is ready.`,
    });
    if (emp.email) {
      const tpl = payslipAvailable({ employeeName: emp.name, period, netPay });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.status(201).json({ success: true, message: 'Payslip created.', data: populated });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: 'A payslip for this employee and period already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/payslips/remittance?period=<period>&type=paye|pension|nhf – HR only.
// CSV export of one payroll period's statutory deductions, one file per
// filing body: PAYE -> FIRS, Pension -> PenCom, NHF -> Federal Mortgage
// Bank of Nigeria. This is a starting point for HR to file manually — it is
// NOT a certified template from any of these bodies, and the pension
// "pensionable pay" figure inherits the Basic+Allowances approximation
// noted in utils/payrollCalc.js (statutorily it's Basic+Housing+Transport,
// which this system doesn't track as separate components).
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const getRemittanceReport = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { period, type } = req.query;
    if (!period) return res.status(400).json({ success: false, message: 'period is required.' });
    if (!['paye', 'pension', 'nhf'].includes(type))
      return res.status(400).json({ success: false, message: 'type must be one of: paye, pension, nhf.' });

    // regulatory.* is select: false and encrypted at rest — force-include it
    // here and decrypt for real (not masked) since a remittance filing needs
    // the actual TIN/RSA/PFA/NHF number, not a last-4 display value.
    const payslips = (await Payslip.find({ tenantId: tid, period })
      .populate({ path: 'employeeId', select: 'name regulatory basicSalary allowances +regulatory.tin +regulatory.rsa +regulatory.pfa +regulatory.nhf' }))
      .sort((a, b) => (a.employeeId?.name || '').localeCompare(b.employeeId?.name || ''));

    if (payslips.length === 0)
      return res.status(404).json({ success: false, message: `No payslips found for period "${period}".` });

    const rows = [];
    let total = 0;

    if (type === 'paye') {
      rows.push(['Employee Name', 'TIN', 'Gross Pay', 'PAYE Amount'].map(esc).join(','));
      for (const p of payslips) {
        const amount = p.deductions?.paye || 0;
        total += amount;
        rows.push([p.employeeId?.name || 'Deleted Employee', decryptRegulatoryField(p.employeeId?.regulatory?.tin), p.grossPay, amount].map(esc).join(','));
      }
    } else if (type === 'pension') {
      rows.push(['Employee Name', 'RSA/PIN', 'PFA', 'Pensionable Pay', 'Employee Pension (8%)'].map(esc).join(','));
      for (const p of payslips) {
        const amount = p.deductions?.pension || 0;
        total += amount;
        rows.push([p.employeeId?.name || 'Deleted Employee', decryptRegulatoryField(p.employeeId?.regulatory?.rsa), decryptRegulatoryField(p.employeeId?.regulatory?.pfa), p.grossPay, amount].map(esc).join(','));
      }
    } else {
      rows.push(['Employee Name', 'NHF Number', 'Basic Salary', 'NHF Amount (2.5%)'].map(esc).join(','));
      for (const p of payslips) {
        const amount = p.deductions?.nhf || 0;
        total += amount;
        rows.push([p.employeeId?.name || 'Deleted Employee', decryptRegulatoryField(p.employeeId?.regulatory?.nhf), p.basicSalary, amount].map(esc).join(','));
      }
    }

    rows.push('');
    rows.push(['TOTAL', total.toFixed(2)].map(esc).join(','));

    const filename = `${type}-remittance-${period.replace(/\s+/g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.join('\n'));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/payslips/:id/pdf  – employees can only download their own
export const getPayslipPdf = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { _id: req.params.id, tenantId: tid };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;

    const payslip = await Payslip.findOne(query)
      .populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } });

    if (!payslip) return res.status(404).json({ success: false, message: 'Payslip not found.' });

    const tenant = await Tenant.findById(tid).select('name').lean();
    streamPayslipPdf(res, payslip, tenant?.name);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
