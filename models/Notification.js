import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientModel: { type: String, enum: ['User', 'Employee'], required: true },
  type: { type: String, required: true, trim: true }, // e.g. 'leave', 'payslip', 'kpi', 'onboarding'
  title: { type: String, required: true, trim: true },
  message: { type: String, trim: true },
  link: { type: String, trim: true }, // frontend tab id to deep-link to, e.g. 'leaves'
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ recipientId: 1, recipientModel: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
