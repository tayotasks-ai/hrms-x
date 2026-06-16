import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  description: { 
    type: String, 
    trim: true 
  },
  headOfDepartmentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Employee',
    default: null
  },
  parentDepartmentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Department',
    default: null
  },
  budgetCode: { 
    type: String, 
    trim: true 
  },
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['Active', 'Inactive'], 
    default: 'Active' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// A department name should be unique within a single tenant
departmentSchema.index({ name: 1, tenantId: 1 }, { unique: true });

const Department = mongoose.model('Department', departmentSchema);
export default Department;
