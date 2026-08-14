import mongoose from 'mongoose';

const punchSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  location: {
    lat: Number,
    lng: Number,
    accuracy: Number, // meters, as reported by the browser Geolocation API
  },
}, { _id: false });

const attendanceSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  // Calendar date the punch belongs to, as YYYY-MM-DD (server UTC day). Keeping
  // this as a plain string makes "one record per employee per day" a simple
  // unique index instead of a timezone-sensitive date-range query.
  date: { type: String, required: true },
  clockIn: punchSchema,
  clockOut: punchSchema,
  createdAt: { type: Date, default: Date.now },
});

attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ tenantId: 1, date: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);
export default Attendance;
