import AuditLog from '../models/AuditLog.js';

// Fire-and-forget audit entry. Silently no-ops if `changes` is empty so
// callers can build a diff unconditionally and just call this at the end.
export const recordAudit = async ({ tenantId, actor, targetType, targetId, targetName, changes }) => {
  if (!changes || changes.length === 0) return;
  try {
    await AuditLog.create({ tenantId, actor, targetType, targetId, targetName, changes });
  } catch (err) {
    // Never let audit logging break the actual request
    console.error('Audit log write failed:', err.message);
  }
};
