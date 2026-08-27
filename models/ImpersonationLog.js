import mongoose from 'mongoose';

// Always-on audit trail for platform-admin impersonation ("log in as this
// tenant's HR_Admin"). Unlike AuditLog (which no-ops when there's nothing to
// diff), every impersonation gets an entry here regardless — the event
// itself, not a field change, is what needs to be recoverable later. Never
// deleted or edited after creation.
const impersonationLogSchema = new mongoose.Schema({
  platformAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', required: true },
  platformAdminName: { type: String, required: true }, // snapshot
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  tenantName: { type: String, required: true }, // snapshot
  impersonatedUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
  impersonatedUserName: { type: String, required: true }, // snapshot
  impersonatedUserRole: { type: String, required: true },
  startedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

impersonationLogSchema.index({ tenantId: 1, startedAt: -1 });
impersonationLogSchema.index({ platformAdminId: 1, startedAt: -1 });

const ImpersonationLog = mongoose.model('ImpersonationLog', impersonationLogSchema);
export default ImpersonationLog;
