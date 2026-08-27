import mongoose from 'mongoose';
import Requisition from '../models/Requisition.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { requisitionStatusUpdate } from '../utils/emailTemplates.js';

// Same base64-in/GridFS-out pattern as monitoringController.js's screenshot
// upload — kept consistent rather than switching to a third-party host like
// Cloudinary. Receipts/invoices/quotes are small compared to full-screen
// captures, but the ceiling matches for simplicity.
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const getAttachmentBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'requisition-attachments' });

// Pure function, unit-tested separately. HR can view any attachment within
// their own tenant (tenant scoping is applied by the query that finds the
// requisition itself); an Employee can only view attachments on their own
// requisitions — otherwise one employee could guess another's attachment URL
// and see a coworker's receipt.
export const canViewRequisitionAttachment = (userRole, viewerId, requisitionEmployeeId) => {
  if (userRole !== 'Employee') return true;
  if (!viewerId || !requisitionEmployeeId) return false;
  return String(viewerId) === String(requisitionEmployeeId);
};

// Converts { imageBase64, contentType, filename } entries from the request
// body into GridFS-backed attachment metadata. Throws on anything empty,
// oversized, or malformed so the caller can turn that into a 400.
const uploadAttachments = async (rawAttachments, tenantId, employeeId) => {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return [];
  const bucket = getAttachmentBucket();
  const results = [];
  for (const [i, att] of rawAttachments.entries()) {
    const { imageBase64, contentType, filename } = att || {};
    if (!imageBase64) throw new Error(`Attachment ${i + 1} is missing imageBase64.`);
    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.length === 0) throw new Error(`Attachment ${i + 1} is empty.`);
    if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment ${i + 1} is too large — please compress it first.`);

    const storedName = `${tenantId}_${employeeId}_${Date.now()}_${i}_${filename || 'attachment'}`;
    const uploadStream = bucket.openUploadStream(storedName, { contentType: contentType || 'image/jpeg' });
    await new Promise((resolve, reject) => {
      uploadStream.once('error', reject);
      uploadStream.once('finish', resolve);
      uploadStream.end(buffer);
    });

    results.push({
      fileId: uploadStream.id,
      filename: filename || `attachment-${i + 1}`,
      contentType: contentType || 'image/jpeg',
      sizeBytes: buffer.length,
    });
  }
  return results;
};

export const getRequisitions = async (req, res) => {
  try {
    const query = { tenantId: req.tenantId };
    if (req.userRole === 'Employee') query.employeeId = req.user._id;
    const records = await Requisition.find(query)
      .populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createRequisition = async (req, res) => {
  try {
    const tid = req.tenantId;
    let { employeeId, attachments: rawAttachments, ...rest } = req.body;
    if (req.userRole === 'Employee') employeeId = req.user._id;
    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    let attachments = [];
    try {
      attachments = await uploadAttachments(rawAttachments, tid, employeeId);
    } catch (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    const record = await Requisition.create({ ...rest, employeeId, tenantId: tid, status: 'Pending', attachments });
    const populated = await Requisition.findById(record._id).populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } });
    res.status(201).json({ success: true, message: 'Requisition submitted.', data: populated });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/requisitions/:id/attachments/:attachmentId/image — streams the
// raw image bytes. Gated by canViewRequisitionAttachment above.
export const getRequisitionAttachmentImage = async (req, res) => {
  try {
    const record = await Requisition.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!record) return res.status(404).json({ success: false, message: 'Requisition not found.' });

    if (!canViewRequisitionAttachment(req.userRole, req.user._id, record.employeeId))
      return res.status(403).json({ success: false, message: 'Forbidden.' });

    const attachment = record.attachments.id(req.params.attachmentId);
    if (!attachment) return res.status(404).json({ success: false, message: 'Attachment not found.' });

    const bucket = getAttachmentBucket();
    res.set('Content-Type', attachment.contentType || 'image/jpeg');
    bucket.openDownloadStream(attachment.fileId)
      .on('error', () => res.status(404).end())
      .pipe(res);
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const updateRequisitionStatus = async (req, res) => {
  try {
    const record = await Requisition.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { status: req.body.status },
      { new: true }
    ).populate({ path: 'employeeId', select: 'name role departmentId email', populate: { path: 'departmentId', select: 'name' } });
    if (!record) return res.status(404).json({ success: false, message: 'Requisition not found.' });

    // Fire-and-forget – notify employee
    if (record.employeeId?.email) {
      const tpl = requisitionStatusUpdate({
        employeeName: record.employeeId.name,
        itemName: record.itemName || record.description,
        status: req.body.status,
      });
      sendEmail({ to: record.employeeId.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.json({ success: true, message: 'Status updated.', data: record });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
