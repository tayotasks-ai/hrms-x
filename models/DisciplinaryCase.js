import mongoose from 'mongoose';

const actionHistorySchema = new mongoose.Schema({
  actionType: {
    type: String, // e.g. 'Query Issued', 'Response Received', 'Panel Assigned', 'Hearing Scheduled', 'Outcome Decided'
    required: true
  },
  actionDate: {
    type: Date,
    default: Date.now
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  notes: {
    type: String
  }
});

const disciplinaryCaseSchema = new mongoose.Schema({
  caseId: {
    type: String,
    required: true,
    unique: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  caseType: {
    type: String,
    enum: ['Disciplinary', 'Grievance'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  reportedEmployee: {
    type: mongoose.Schema.Types.ObjectId, // Employee being reported/investigated
    ref: 'Employee',
    required: true
  },
  reporter: {
    type: mongoose.Schema.Types.ObjectId, // Who reported it (can be null if anonymous grievance)
    ref: 'Employee'
  },
  status: {
    type: String,
    enum: ['Open', 'Under Investigation', 'Query Issued', 'Awaiting Response', 'Hearing', 'Closed'],
    default: 'Open'
  },
  investigatingOfficer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  panelMembers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }],
  queryDetails: {
    issuedDate: Date,
    deadlineDate: Date,
    responseReceived: Boolean,
    responseText: String
  },
  outcome: {
    type: String,
    enum: ['Pending', 'No Action', 'Verbal Warning', 'Written Warning', 'Suspension', 'Dismissal']
  },
  history: [actionHistorySchema],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to generate caseId if it doesn't exist
disciplinaryCaseSchema.pre('save', async function(next) {
  if (!this.caseId) {
    const prefix = this.caseType === 'Grievance' ? 'GRV' : 'DSC';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const dateStr = new Date().toISOString().slice(2, 7).replace('-', '');
    this.caseId = `${prefix}-${dateStr}-${randomNum}`;
  }
  next();
});

const DisciplinaryCase = mongoose.model('DisciplinaryCase', disciplinaryCaseSchema);
export default DisciplinaryCase;
