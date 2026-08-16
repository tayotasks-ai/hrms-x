import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import Employee from '../models/Employee.js';
import MonitoringSnapshot from '../models/MonitoringSnapshot.js';
import { recordAudit } from '../utils/auditLog.js';

// Agent should downscale/compress before sending — this is a sanity ceiling,
// not a target size. Kept well under the raised express.json() limit (see
// server.js) so a rejected upload fails fast with a clear message instead of
// the request body parser choking first.
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;

// Pure function, unit-tested separately. Screenshot capture requires BOTH:
// the tenant has explicitly turned the feature on, AND this specific
// employee has separately consented inside the agent. Neither one alone is
// enough — this is deliberate double opt-in, not a single admin switch.
export const isScreenshotUploadAllowed = (tenantMonitoring, employeeMonitoringConsent) => {
  return !!tenantMonitoring?.screenshotsEnabled && !!employeeMonitoringConsent?.accepted;
};

const getBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'screenshots' });

// GET /api/monitoring/settings — HR only
export const getMonitoringSettings = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('monitoring');
    res.json({
      success: true,
      data: tenant?.monitoring || { screenshotsEnabled: false, screenshotIntervalMinutes: 30 },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/monitoring/settings — HR only. Body: { screenshotsEnabled, screenshotIntervalMinutes }
export const updateMonitoringSettings = async (req, res) => {
  try {
    const { screenshotsEnabled, screenshotIntervalMinutes } = req.body;
    const update = {};

    if (typeof screenshotsEnabled === 'boolean') {
      update['monitoring.screenshotsEnabled'] = screenshotsEnabled;
    }
    if (screenshotIntervalMinutes !== undefined) {
      const mins = Number(screenshotIntervalMinutes);
      if (!Number.isFinite(mins) || mins < 5)
        return res.status(400).json({ success: false, message: 'screenshotIntervalMinutes must be a number of at least 5.' });
      update['monitoring.screenshotIntervalMinutes'] = mins;
    }
    if (Object.keys(update).length === 0)
      return res.status(400).json({ success: false, message: 'Nothing to update.' });

    await Tenant.findByIdAndUpdate(req.tenantId, update);

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: 'User' },
      targetType: 'MonitoringSettings',
      targetId: req.tenantId,
      targetName: 'Screenshot monitoring settings',
      changes: Object.entries(update).map(([field, to]) => ({ field, from: '—', to: String(to) })),
    });

    res.json({ success: true, message: 'Monitoring settings updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/monitoring/consent — Employee (agent) only. Body: { accepted, version }
// Separate from PUT /api/auth/consent (the general privacy notice) — this is
// specifically the desktop agent's screenshot-consent screen.
export const setMonitoringConsent = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts set monitoring consent.' });

    const { accepted, version } = req.body;
    const emp = await Employee.findById(req.user._id);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    emp.monitoringConsent = { accepted: !!accepted, acceptedAt: new Date(), version: version || 'v1' };
    await emp.save();

    res.json({ success: true, data: emp.monitoringConsent });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/monitoring/screenshot — Employee (agent) only.
// Body: { imageBase64, contentType } — a single already-captured,
// already-compressed still image. Hard-gated per isScreenshotUploadAllowed()
// above; a client that skips its own consent screen still can't upload,
// because the server checks independently rather than trusting the agent.
export const uploadScreenshot = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts upload screenshots.' });

    const tenant = await Tenant.findById(req.tenantId).select('monitoring');
    const emp = await Employee.findById(req.user._id).select('monitoringConsent');

    if (!isScreenshotUploadAllowed(tenant?.monitoring, emp?.monitoringConsent))
      return res.status(403).json({ success: false, message: 'Screenshot monitoring is not enabled, or consent has not been given.' });

    const { imageBase64, contentType } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: 'imageBase64 is required.' });

    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.length === 0)
      return res.status(400).json({ success: false, message: 'Empty image payload.' });
    if (buffer.length > MAX_SCREENSHOT_BYTES)
      return res.status(413).json({ success: false, message: 'Screenshot too large — the agent should downscale/compress before sending.' });

    const bucket = getBucket();
    const filename = `${req.tenantId}_${req.user._id}_${Date.now()}.png`;
    const uploadStream = bucket.openUploadStream(filename, { contentType: contentType || 'image/png' });

    await new Promise((resolve, reject) => {
      uploadStream.once('error', reject);
      uploadStream.once('finish', resolve);
      uploadStream.end(buffer);
    });

    const snapshot = await MonitoringSnapshot.create({
      employeeId: req.user._id,
      tenantId: req.tenantId,
      fileId: uploadStream.id,
      contentType: contentType || 'image/png',
      sizeBytes: buffer.length,
    });

    res.status(201).json({ success: true, data: { _id: snapshot._id, takenAt: snapshot.takenAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/monitoring/screenshots?employeeId=&date=YYYY-MM-DD&page=&limit= — HR only.
export const getScreenshots = async (req, res) => {
  try {
    const query = { tenantId: req.tenantId };
    if (req.query.employeeId) query.employeeId = req.query.employeeId;
    if (req.query.date) {
      const start = new Date(`${req.query.date}T00:00:00.000Z`);
      const end = new Date(`${req.query.date}T23:59:59.999Z`);
      query.takenAt = { $gte: start, $lte: end };
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const [records, total] = await Promise.all([
      MonitoringSnapshot.find(query)
        .populate('employeeId', 'name')
        .sort({ takenAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      MonitoringSnapshot.countDocuments(query),
    ]);

    res.json({ success: true, data: { records, total, page, limit } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/monitoring/screenshots/:id/image — HR only. Streams the raw image bytes.
export const getScreenshotImage = async (req, res) => {
  try {
    const snapshot = await MonitoringSnapshot.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!snapshot) return res.status(404).json({ success: false, message: 'Screenshot not found.' });

    const bucket = getBucket();
    res.set('Content-Type', snapshot.contentType || 'image/png');
    bucket.openDownloadStream(snapshot.fileId)
      .on('error', () => res.status(404).end())
      .pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/monitoring/screenshots/:id — HR only.
export const deleteScreenshot = async (req, res) => {
  try {
    const snapshot = await MonitoringSnapshot.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!snapshot) return res.status(404).json({ success: false, message: 'Screenshot not found.' });

    const bucket = getBucket();
    await bucket.delete(snapshot.fileId).catch(() => {}); // tolerate a file that's already gone
    await snapshot.deleteOne();

    res.json({ success: true, message: 'Screenshot deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
