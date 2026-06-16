import Requisition from '../models/Requisition.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { requisitionStatusUpdate } from '../utils/emailTemplates.js';

export const getRequisitions = async (req, res) => {
  try {
    const query = { tenantId: req.tenantId };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;
    const records = await Requisition.find(query)
      .populate('employeeId', 'name role department email')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createRequisition = async (req, res) => {
  try {
    const tid = req.tenantId;
    let { employeeId } = req.body;
    if (req.userRole === 'Employee') employeeId = req.user._id;
    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
    const record = await Requisition.create({ ...req.body, employeeId, tenantId: tid, status: 'Pending' });
    const populated = await Requisition.findById(record._id).populate('employeeId', 'name role department email');
    res.status(201).json({ success: true, message: 'Requisition submitted.', data: populated });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const updateRequisitionStatus = async (req, res) => {
  try {
    const record = await Requisition.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { status: req.body.status },
      { new: true }
    ).populate('employeeId', 'name role department email');
    if (!record) return res.status(404).json({ success: false, message: 'Requisition not found.' });

    // Fire-and-forget – notify employee
    if (record.employeeId?.email) {
      const tpl = requisitionStatusUpdate({
        employeeName: record.employeeId.name,
        itemName: record.itemName || record.description,
        status: req.body.status,
      });
      sendEmail({ to: record.employeeId.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.json({ success: true, message: 'Status updated.', data: record });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
