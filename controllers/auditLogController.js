import AuditLog from '../models/AuditLog.js';

// GET /api/audit-log  – HR only. Most recent sensitive-field changes tenant-wide.
export const getAuditLog = async (req, res) => {
  try {
    const logs = await AuditLog.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
