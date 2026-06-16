import mongoose from 'mongoose';

const onboardingSchema = new mongoose.Schema({
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
  stage: {
    type: String,
    enum: ['Pre-boarding', 'Day 1', '30 Days', '60 Days', '90 Days', 'Completed'],
    default: 'Pre-boarding'
  },
  tasks: [{
    title: String,
    description: String,
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee' // or User depending on assignment
    },
    dueDate: Date,
    status: {
      type: String,
      enum: ['Pending', 'Completed'],
      default: 'Pending'
    },
    completedAt: Date
  }],
  completionPercentage: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Calculate completion percentage before save
onboardingSchema.pre('save', function(next) {
  if (this.tasks && this.tasks.length > 0) {
    const completed = this.tasks.filter(t => t.status === 'Completed').length;
    this.completionPercentage = Math.round((completed / this.tasks.length) * 100);
  }
  next();
});

onboardingSchema.index({ employeeId: 1, tenantId: 1 });

const Onboarding = mongoose.model('Onboarding', onboardingSchema);
export default Onboarding;
