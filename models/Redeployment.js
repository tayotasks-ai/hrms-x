import mongoose from 'mongoose';

const redeploymentSchema = new mongoose.Schema({
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
  effectiveDate: {
    type: Date,
    required: true
  },
  // Previous State
  fromDepartment: {
    type: String,
    required: true
  },
  fromRole: {
    type: String,
    required: true
  },
  fromLocation: {
    type: String,
    default: null
  },
  fromManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null
  },
  // New State
  toDepartment: {
    type: String,
    required: true
  },
  toRole: {
    type: String,
    required: true
  },
  toLocation: {
    type: String,
    default: null
  },
  toManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Completed', 'Cancelled'],
    default: 'Scheduled'
  },
  reason: {
    type: String,
    trim: true,
    required: true
  },
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Redeployment = mongoose.model('Redeployment', redeploymentSchema);
export default Redeployment;
