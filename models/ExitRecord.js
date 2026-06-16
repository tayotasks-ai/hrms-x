import mongoose from 'mongoose';

const clearanceTaskSchema = new mongoose.Schema({
  department: {
    type: String, // e.g., 'IT', 'Finance', 'HR', 'Line Manager'
    required: true
  },
  taskName: {
    type: String,
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null
  },
  status: {
    type: String,
    enum: ['Pending', 'Cleared'],
    default: 'Pending'
  },
  clearedAt: {
    type: Date,
    default: null
  },
  comments: {
    type: String,
    default: ''
  }
});

const exitRecordSchema = new mongoose.Schema({
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
  exitType: {
    type: String,
    enum: ['Resignation', 'Retirement', 'Redundancy', 'Termination', 'Contract End'],
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  lastWorkingDay: {
    type: Date,
    required: true
  },
  clearanceChecklist: [clearanceTaskSchema],
  status: {
    type: String,
    enum: ['Initiated', 'In Clearance', 'Cleared', 'Completed'],
    default: 'Initiated'
  },
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const ExitRecord = mongoose.model('ExitRecord', exitRecordSchema);
export default ExitRecord;
