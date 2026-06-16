import mongoose from 'mongoose';

const jobFamilySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  description: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const JobFamily = mongoose.model('JobFamily', jobFamilySchema);

const jobRoleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  familyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobFamily',
    required: true
  },
  band: {
    type: String, // e.g. L1, L2, L3, L4
    required: true
  },
  payGrade: {
    minSalary: Number,
    maxSalary: Number,
    currency: { type: String, default: 'NGN' }
  },
  competencies: [{
    skill: String,
    proficiencyLevel: {
      type: String,
      enum: ['Basic', 'Intermediate', 'Advanced', 'Expert']
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const JobRole = mongoose.model('JobRole', jobRoleSchema);
