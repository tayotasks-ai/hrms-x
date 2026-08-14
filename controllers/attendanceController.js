import Attendance from '../models/Attendance.js';

// Server-day the punch belongs to, as YYYY-MM-DD (UTC).
const todayStr = () => new Date().toISOString().split('T')[0];

// POST /api/attendance/clock-in  – Employee ESS only
export const clockIn = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts can clock in.' });

    const tid = req.tenantId;
    const empId = req.user._id;
    const date = todayStr();
    const { lat, lng, accuracy } = req.body.location || {};

    const existing = await Attendance.findOne({ employeeId: empId, tenantId: tid, date });
    if (existing?.clockIn?.at)
      return res.status(409).json({ success: false, message: 'Already clocked in today.' });

    const record = await Attendance.findOneAndUpdate(
      { employeeId: empId, tenantId: tid, date },
      { $set: { clockIn: { at: new Date(), location: { lat, lng, accuracy } } } },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, message: 'Clocked in.', data: record });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: 'Already clocked in today.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/attendance/clock-out  – Employee ESS only
export const clockOut = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts can clock out.' });

    const tid = req.tenantId;
    const empId = req.user._id;
    const date = todayStr();
    const { lat, lng, accuracy } = req.body.location || {};

    const existing = await Attendance.findOne({ employeeId: empId, tenantId: tid, date });
    if (!existing?.clockIn?.at)
      return res.status(400).json({ success: false, message: "You haven't clocked in today." });
    if (existing.clockOut?.at)
      return res.status(409).json({ success: false, message: 'Already clocked out today.' });

    existing.clockOut = { at: new Date(), location: { lat, lng, accuracy } };
    await existing.save();

    res.json({ success: true, message: 'Clocked out.', data: existing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/me  – Employee's own last 14 days
export const getMyAttendance = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts have attendance records.' });

    const records = await Attendance.find({ employeeId: req.user._id, tenantId: req.tenantId })
      .sort({ date: -1 })
      .limit(14);

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/today  – HR only. Who's clocked in today, tenant-wide.
export const getTodayAttendance = async (req, res) => {
  try {
    const records = await Attendance.find({ tenantId: req.tenantId, date: todayStr() })
      .populate({ path: 'employeeId', select: 'name role departmentId', populate: { path: 'departmentId', select: 'name' } })
      .sort({ 'clockIn.at': 1 });

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
