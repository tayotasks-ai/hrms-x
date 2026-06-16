import EmploymentHistory from '../models/EmploymentHistory.js';

export const getEmploymentHistories = async (req, res) => {
  try {
    const query = { tenantId: req.tenantId };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;
    const records = await EmploymentHistory.find(query)
      .populate('employeeId', 'name role department')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createEmploymentHistory = async (req, res) => {
  try {
    const record = await EmploymentHistory.create({ ...req.body, tenantId: req.tenantId });
    res.status(201).json({ success: true, data: record });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
