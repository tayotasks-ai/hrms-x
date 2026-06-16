import mongoose from 'mongoose';

const complianceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  title: { type: String, required: true, trim: true },
  category: { type: String, enum: ['Pension', 'Tax', 'Housing', 'Training', 'Insurance', 'Health', 'Other'], required: true },
  frequency: { type: String, enum: ['Monthly', 'Quarterly', 'Annual', 'One-off'], default: 'Monthly' },
  regulator: { type: String, trim: true },
  dueDate: { type: Date },
  dueDay: { type: Number },  // day of month for monthly obligations
  status: { type: String, enum: ['Pending', 'Completed', 'Overdue', 'Not Applicable'], default: 'Pending' },
  completedDate: { type: Date },
  referenceNumber: { type: String },
  notes: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const Compliance = mongoose.model('Compliance', complianceSchema);
export default Compliance;
