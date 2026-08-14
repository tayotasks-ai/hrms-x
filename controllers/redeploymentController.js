import Redeployment from '../models/Redeployment.js';
import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import { sendEmail } from '../utils/email.js';
import { redeploymentInitiated, redeploymentCompleted } from '../utils/emailTemplates.js';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const getRedeployments = async (req, res) => {
  try {
    const records = await Redeployment.find({ tenantId: req.tenantId })
      .populate('employeeId', 'name email status departmentId role')
      .populate('fromManager', 'name').populate('toManager', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createRedeployment = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { employeeId, toDepartment, toRole, toLocation, effectiveDate } = req.body;
    if (!employeeId || !toDepartment || !toRole || !effectiveDate)
      return res.status(400).json({ success: false, message: 'employeeId, toDepartment, toRole, effectiveDate required.' });
    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid }).populate('departmentId', 'name');
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
    const fromDepartmentName = emp.departmentId?.name || 'Unassigned';
    const record = await Redeployment.create({
      ...req.body, tenantId: tid,
      fromDepartment: fromDepartmentName,
      fromRole: emp.role,
    });

    // Fire-and-forget – notify employee
    if (emp.email) {
      const tpl = redeploymentInitiated({
        employeeName: emp.name,
        fromDept: fromDepartmentName, toDept: toDepartment,
        toRole, effectiveDate: fmtDate(effectiveDate),
      });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.status(201).json({ success: true, message: 'Transfer initiated.', data: record });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const completeRedeployment = async (req, res) => {
  try {
    const tid = req.tenantId;
    const record = await Redeployment.findOne({ _id: req.params.id, tenantId: tid });
    if (!record) return res.status(404).json({ success: false, message: 'Transfer not found.' });
    // Update employee record
    const toDept = await Department.findOne({ tenantId: tid, name: record.toDepartment });
    const employeeUpdate = { role: record.toRole };
    if (toDept) employeeUpdate.departmentId = toDept._id;
    if (record.toManager) employeeUpdate.managerId = record.toManager;
    await Employee.findByIdAndUpdate(record.employeeId, employeeUpdate);
    record.status = 'Completed';
    record.completedAt = new Date();
    await record.save();

    // Fire-and-forget – notify employee
    Employee.findById(record.employeeId).select('name email').lean()
      .then(emp => {
        if (emp?.email) {
          const tpl = redeploymentCompleted({
            employeeName: emp.name,
            toDept: record.toDepartment,
            toRole: record.toRole,
          });
          sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
        }
      })
      .catch(err => console.error('Email lookup failed:', err.message));

    res.json({ success: true, message: 'Transfer completed. Employee record updated.', data: record });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

