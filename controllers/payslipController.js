import Payslip from '../models/Payslip.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { payslipAvailable } from '../utils/emailTemplates.js';

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
export const createPayslip = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { employeeId, period, basicSalary, allowances, deductions, payslipType } = req.body;
    if (!employeeId || !period || basicSalary === undefined)
      return res.status(400).json({ success: false, message: 'employeeId, period, and basicSalary are required.' });

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const grossPay = (basicSalary || 0) + (allowances || 0);
    const netPay = grossPay - (deductions || 0);

    const payslip = await Payslip.create({
      employeeId, tenantId: tid, period,
      basicSalary, allowances: allowances || 0,
      deductions: deductions || 0,
      grossPay, netPay,
      payslipType: payslipType || 'Regular',
      status: 'Paid',
    });

    const populated = await Payslip.findById(payslip._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } });

    // Fire-and-forget – notify employee
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
