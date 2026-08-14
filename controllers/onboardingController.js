import Onboarding from '../models/Onboarding.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { onboardingPlanCreated } from '../utils/emailTemplates.js';
import { notify } from '../utils/notify.js';

// GET /api/onboarding
export const getOnboardings = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;

    const records = await Onboarding.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } })
      .populate('tasks.assignedTo', 'name role')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/onboarding  – HR creates onboarding plan for new hire
export const createOnboarding = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { employeeId, tasks } = req.body;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId is required.' });

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const existing = await Onboarding.findOne({ employeeId, tenantId: tid });
    if (existing) return res.status(409).json({ success: false, message: 'Onboarding record already exists for this employee.' });

    const record = await Onboarding.create({
      employeeId, tenantId: tid,
      stage: 'Pre-boarding',
      tasks: tasks || [],
    });

    const populated = await Onboarding.findById(record._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } })
      .populate('tasks.assignedTo', 'name role');

    // Fire-and-forget – notify employee
    notify({
      tenantId: tid, recipientId: emp._id, recipientModel: 'Employee',
      type: 'onboarding', link: 'onboarding',
      title: 'Your onboarding plan is ready',
      message: `HR set up an onboarding checklist for you with ${(tasks || []).length} task(s).`,
    });
    if (emp.email) {
      const tpl = onboardingPlanCreated({ employeeName: emp.name, taskCount: (tasks || []).length });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.status(201).json({ success: true, message: 'Onboarding plan created.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/onboarding/:id/task/:taskId  – mark task complete
export const updateOnboardingTask = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { id, taskId } = req.params;
    const { status } = req.body;

    const record = await Onboarding.findOne({ _id: id, tenantId: tid });
    if (!record) return res.status(404).json({ success: false, message: 'Onboarding record not found.' });

    const task = record.tasks.id(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

    task.status = status || 'Completed';
    if (status === 'Completed') task.completedAt = new Date();

    // Recalculate stage based on completed tasks
    const completedCount = record.tasks.filter(t => t.status === 'Completed').length;
    const total = record.tasks.length;
    record.completionPercentage = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    await record.save();

    const populated = await Onboarding.findById(record._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } })
      .populate('tasks.assignedTo', 'name role');

    res.json({ success: true, message: 'Task updated.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/onboarding/:id/task  – HR only. Append a new task to an existing plan.
export const addOnboardingTask = async (req, res) => {
  try {
    const tid = req.tenantId;
    const record = await Onboarding.findOne({ _id: req.params.id, tenantId: tid });
    if (!record) return res.status(404).json({ success: false, message: 'Onboarding record not found.' });

    const { title, description, assignedTo, dueDate } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Task title is required.' });

    record.tasks.push({
      title: title.trim(),
      description: description?.trim() || '',
      assignedTo: assignedTo || undefined,
      dueDate: dueDate || undefined,
      status: 'Pending',
    });
    await record.save(); // pre('save') hook recalculates completionPercentage

    const populated = await Onboarding.findById(record._id)
      .populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } })
      .populate('tasks.assignedTo', 'name role');

    res.status(201).json({ success: true, message: 'Task added.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/onboarding/:id  – HR only. Removes an onboarding plan entirely
// (e.g. created in error, or the hire fell through).
export const deleteOnboarding = async (req, res) => {
  try {
    const record = await Onboarding.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!record) return res.status(404).json({ success: false, message: 'Onboarding record not found.' });
    res.json({ success: true, message: 'Onboarding plan deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/onboarding/:id/stage  – advance stage (HR only)
export const updateOnboardingStage = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { stage } = req.body;
    const validStages = ['Pre-boarding', 'Day 1', '30 Days', '60 Days', '90 Days', 'Completed'];
    if (!validStages.includes(stage))
      return res.status(400).json({ success: false, message: 'Invalid stage.' });

    const record = await Onboarding.findOneAndUpdate(
      { _id: req.params.id, tenantId: tid },
      { stage },
      { new: true }
    ).populate({ path: 'employeeId', select: 'name role departmentId email joinDate', populate: { path: 'departmentId', select: 'name' } });

    if (!record) return res.status(404).json({ success: false, message: 'Onboarding record not found.' });
    res.json({ success: true, message: 'Stage updated.', data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
