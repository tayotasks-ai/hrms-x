import mongoose from 'mongoose';

const employmentHistorySchema = new mongoose.Schema({
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
    enum: ['Contract', 'Promotion', 'Salary Notch', 'Disciplinary'],
    required: true
  },
  department: String,
  role: String,
  grade: String,
  startDate: Date,
  endDate: Date,
  
  // For Salary Notch changes
  previousValue: Number,
  newValue: Number,
  difference: Number,
  
  // For tracking who made the change
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  justification: String,
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Queries will often be by employeeId
employmentHistorySchema.index({ employeeId: 1, tenantId: 1 });

const EmploymentHistory = mongoose.model('EmploymentHistory', employmentHistorySchema);
export default EmploymentHistory;
