import mongoose from 'mongoose';

// A lightweight, append-only record of who changed a sensitive field on an
// employee, from what, to what, and when. Not a full change-data-capture
// system — just enough to answer "who changed X's salary and when" without
// digging through the database directly.
const auditLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  actor: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    model: { type: String, enum: ['User', 'Employee'], required: true }, // who made the change
  },
  targetType: { type: String, required: true }, // e.g. 'Employee'
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  targetName: { type: String, required: true }, // snapshot, survives target deletion
  changes: [{
    field: { type: String, required: true },
    from: { type: mongoose.Schema.Types.Mixed },
    to: { type: mongoose.Schema.Types.Mixed },
  }],
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ tenantId: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
