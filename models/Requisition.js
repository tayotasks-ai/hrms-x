import mongoose from 'mongoose';

const requisitionSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  type: {
    type: String,
    enum: ['Expense', 'Service'],
    required: true
  },
  // Fields for Expense Requisitions
  amount: {
    type: Number,
    default: null
  },
  costCentre: {
    type: String,
    trim: true,
    default: null
  },
  justification: {
    type: String,
    trim: true
  },
  // Fields for Service Requisitions
  serviceType: {
    type: String,
    trim: true,
    default: null
  },
  urgency: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  preferredVendor: {
    type: String,
    trim: true,
    default: null
  },
  // Common Fields
  description: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Pending', 'Approved', 'Rejected', 'Processed'],
    default: 'Draft'
  },
  // Receipt/invoice/quote images, stored in GridFS (bucket
  // 'requisition-attachments') — see controllers/requisitionController.js.
  // Uploaded as base64 at creation time; fileId points at the GridFS blob,
  // everything else here is just display metadata.
  attachments: [{
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  }],
  managerComments: {
    type: String,
    trim: true,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
requisitionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Requisition = mongoose.model('Requisition', requisitionSchema);
export default Requisition;
