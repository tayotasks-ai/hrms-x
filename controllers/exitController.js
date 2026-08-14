import ExitRecord from '../models/ExitRecord.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { exitInitiated } from '../utils/emailTemplates.js';

export const getExitRecords = async (req, res) => {
  try {
    const records = await ExitRecord.find({ tenantId: req.tenantId })
      .populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } })
      .populate('clearanceChecklist.assignedTo', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const initiateExit = async (req, res) => {
  try {
    // Generate a default clearance checklist
    const defaultChecklist = [
      { department: 'Line Manager', taskName: 'Handover complete' },
      { department: 'IT', taskName: 'Revoke system access and collect hardware' },
      { department: 'Finance', taskName: 'Clear outstanding advances/loans' },
      { department: 'HR', taskName: 'Conduct exit interview' }
    ];

    const newRecord = new ExitRecord({
      ...req.body,
      tenantId: req.tenantId,
      clearanceChecklist: defaultChecklist,
      status: 'In Clearance'
    });

    const saved = await newRecord.save();
    
    // Update employee status to 'Offboarding'
    await Employee.findByIdAndUpdate(saved.employeeId, { status: 'Offboarding' });

    const populated = await ExitRecord.findById(saved._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } })
      .populate('clearanceChecklist.assignedTo', 'name');

    // Fire-and-forget – notify employee
    if (populated.employeeId?.email) {
      const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined;
      const tpl = exitInitiated({
        employeeName: populated.employeeId.name,
        exitType: req.body.exitType,
        lastWorkingDay: fmtDate(req.body.lastWorkingDay),
      });
      sendEmail({ to: populated.employeeId.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const updateClearanceTask = async (req, res) => {
  try {
    const { recordId, taskId } = req.params;
    const { status, comments } = req.body;

    const record = await ExitRecord.findOne({ _id: recordId, tenantId: req.tenantId });
    if (!record) return res.status(404).json({ success: false, message: 'Exit record not found' });

    const task = record.clearanceChecklist.id(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    task.status = status;
    task.comments = comments || task.comments;
    if (status === 'Cleared') {
      task.clearedAt = new Date();
    } else {
      task.clearedAt = null;
    }

    // Check if all tasks are cleared
    const allCleared = record.clearanceChecklist.every(t => t.status === 'Cleared');
    if (allCleared) {
      record.status = 'Cleared';
    } else {
      record.status = 'In Clearance';
    }

    await record.save();
    
    const populated = await ExitRecord.findById(record._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } })
      .populate('clearanceChecklist.assignedTo', 'name');

    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const completeExit = async (req, res) => {
  try {
    const record = await ExitRecord.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { status: 'Completed' },
      { new: true }
    ).populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } });

    if (!record) return res.status(404).json({ success: false, message: 'Exit record not found' });

    // Mark employee as Offboarded
    await Employee.findByIdAndUpdate(record.employeeId, { status: 'Offboarded' });

    res.json({ success: true, data: record });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
