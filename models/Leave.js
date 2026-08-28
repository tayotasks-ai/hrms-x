import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema({
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
    enum: ['Annual', 'Sick', 'Maternity', 'Paternity', 'Compassionate', 'Study', 'Unpaid', 'Emergency'],
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
  workingDays: {
    type: Number,
    required: true,
    default: 0
  },
  status: {
    type: String,
    enum: ['Pending', 'Relief Officer Approved', 'Manager Approved', 'HR Approved', 'Rejected', 'Processed'],
    default: 'Pending'
  },
  reason: {
    type: String,
    trim: true
  },
  reliefOfficer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null
  },
  documentAttachment: {
    type: String, // URL or path to uploaded document
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Leave = mongoose.model('Leave', leaveSchema);
export default Leave;
