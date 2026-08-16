import mongoose from 'mongoose';

// Metadata for a single screenshot captured by the desktop agent. The actual
// image bytes live in MongoDB GridFS (bucket name 'screenshots') — this
// document just points at that file plus who/when, so HR can list and filter
// without pulling image data into every query. See monitoringController.js.
const monitoringSnapshotSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  takenAt: { type: Date, default: Date.now },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // GridFS file _id
  contentType: { type: String, default: 'image/png' },
  sizeBytes: { type: Number },
});

monitoringSnapshotSchema.index({ tenantId: 1, employeeId: 1, takenAt: -1 });

const MonitoringSnapshot = mongoose.model('MonitoringSnapshot', monitoringSnapshotSchema);
export default MonitoringSnapshot;
