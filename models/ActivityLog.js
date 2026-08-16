import mongoose from 'mongoose';

// One document per employee per calendar day. Active minutes accumulate via
// heartbeat pings sent by the frontend while the employee has HRMS X open,
// visible, and focused, and has generated real input (mouse/keyboard/scroll)
// recently. This is in-app active-time tracking, not system-wide screen
// monitoring — see activityController.js for the server-side trust model.
const activityLogSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  // YYYY-MM-DD (server UTC day) — same convention as Attendance.date.
  date: { type: String, required: true },
  activeMinutes: { type: Number, default: 0, min: 0 },
  lastPingAt: { type: Date },
  firstPingAt: { type: Date },
}, { timestamps: true });

activityLogSchema.index({ employeeId: 1, date: 1 }, { unique: true });
activityLogSchema.index({ tenantId: 1, date: 1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
export default ActivityLog;
