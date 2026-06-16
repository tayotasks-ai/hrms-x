import mongoose from 'mongoose';

const trainingCourseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  description: String,
  type: {
    type: String,
    enum: ['Internal', 'External'],
    default: 'Internal'
  },
  isMandatory: {
    type: Boolean,
    default: false
  },
  provider: String,
  durationHours: Number,
  cost: {
    amount: Number,
    currency: { type: String, default: 'NGN' }
  },
  enrollments: [{
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    status: {
      type: String,
      enum: ['Enrolled', 'In Progress', 'Completed', 'Failed', 'Requested', 'Rejected'],
      default: 'Enrolled'
    },
    progressPercentage: { type: Number, default: 0 },
    completionDate: Date,
    certificateUrl: String,
    enrolledAt: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const TrainingCourse = mongoose.model('TrainingCourse', trainingCourseSchema);
