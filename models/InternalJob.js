import mongoose from 'mongoose';

const internalJobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  department: String,
  location: String,
  description: String,
  requirements: [String],
  status: {
    type: String,
    enum: ['Draft', 'Open', 'Closed'],
    default: 'Open'
  },
  closingDate: Date,
  referralBonus: {
    amount: Number,
    currency: { type: String, default: 'NGN' }
  },
  applications: [{
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    status: {
      type: String,
      enum: ['Applied', 'Interviewing', 'Offered', 'Rejected', 'Hired'],
      default: 'Applied'
    },
    appliedAt: { type: Date, default: Date.now }
  }],
  referrals: [{
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    candidateName: String,
    candidateEmail: String,
    resumeUrl: String,
    status: {
      type: String,
      enum: ['Submitted', 'Interviewing', 'Hired', 'Rejected'],
      default: 'Submitted'
    },
    bonusPaid: { type: Boolean, default: false },
    referredAt: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const InternalJob = mongoose.model('InternalJob', internalJobSchema);
