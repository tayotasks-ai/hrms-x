import mongoose from 'mongoose';

const positionSchema = new mongoose.Schema({
  positionId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  department: {
    type: String,
    required: true
  },
  jobRoleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobRole'
  },
  reportsToPositionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Position'
  },
  headcountBudgeted: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['Active', 'Frozen', 'Closed'],
    default: 'Active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Calculate how many employees currently hold this position
positionSchema.virtual('currentHeadcount', {
  ref: 'Employee',
  localField: '_id',
  foreignField: 'positionId',
  count: true,
  match: { status: { $ne: 'Offboarded' } }
});

positionSchema.set('toObject', { virtuals: true });
positionSchema.set('toJSON', { virtuals: true });

export const Position = mongoose.model('Position', positionSchema);
