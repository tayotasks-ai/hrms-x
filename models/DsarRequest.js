import mongoose from 'mongoose';

// Data subject access requests (NDPA Sections 35-39: access, correction,
// erasure). Employees file these against their own record; HR actions them
// from the Compliance tab. "Erasure" is never auto-executed here — HR
// reviews and performs the anonymization manually (see
// controllers/retentionController.js for the same underlying action), since
// financial/payroll records often have their own statutory retention
// requirements independent of the employee's erasure request.
const dsarRequestSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: String, // snapshot — stays readable even if the employee record is later anonymized
  type: { type: String, enum: ['Access', 'Correction', 'Erasure'], required: true },
  details: { type: String, trim: true }, // what they want corrected, or why they're requesting erasure

  status: { type: String, enum: ['Pending', 'In Progress', 'Completed', 'Rejected'], default: 'Pending' },
  resolutionNote: { type: String, trim: true },
  resolvedBy: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
    model: { type: String, enum: ['User'] },
  },
  resolvedAt: Date,

  requestedAt: { type: Date, default: Date.now },
});

dsarRequestSchema.index({ tenantId: 1, status: 1, requestedAt: -1 });

const DsarRequest = mongoose.model('DsarRequest', dsarRequestSchema);
export default DsarRequest;
