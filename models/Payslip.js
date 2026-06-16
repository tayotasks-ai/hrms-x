import mongoose from 'mongoose';

const payslipSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  period: { type: String, required: true, trim: true },
  payslipType: { type: String, enum: ['Regular', 'Bonus', 'Off-cycle'], default: 'Regular' },
  basicSalary: { type: Number, required: true, min: 0 },
  allowances: { type: Number, default: 0 },
  grossPay: { type: Number, default: 0 },
  deductions: {
    paye: { type: Number, default: 0 },
    pension: { type: Number, default: 0 },
    nhf: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  netPay: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['Paid', 'Draft'], default: 'Draft' },
  createdAt: { type: Date, default: Date.now },
});

payslipSchema.index({ employeeId: 1, period: 1 }, { unique: true });
const Payslip = mongoose.model('Payslip', payslipSchema);
export default Payslip;
