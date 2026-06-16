import mongoose from 'mongoose';

const probationSchema = new mongoose.Schema({
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
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Confirmed', 'Extended', 'Terminated'],
    default: 'Active'
  },
  appraisalStatus: {
    type: String,
    enum: ['Pending', 'Submitted', 'Reviewed'],
    default: 'Pending'
  },
  extensionCount: {
    type: Number,
    default: 0
  },
  outcomes: [{
    decision: { type: String, enum: ['Extend', 'Confirm', 'Terminate'] },
    reason: String,
    newEndDate: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

probationSchema.index({ employeeId: 1, tenantId: 1 });

const Probation = mongoose.model('Probation', probationSchema);
export default Probation;
