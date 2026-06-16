import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  title: { type: String, required: true, trim: true },
  category: { type: String, enum: ['Policy', 'Handbook', 'Template', 'Form', 'Compliance', 'Other'], default: 'Policy' },
  fileUrl: { type: String },
  version: { type: String, default: '1.0' },
  visibility: { type: String, default: 'All' }, // 'All', department name, or grade
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  requiresAcknowledgement: { type: Boolean, default: false },
  acknowledgedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Document = mongoose.model('Document', documentSchema);
export default Document;
