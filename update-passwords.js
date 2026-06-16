import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import Employee from './models/Employee.js';

dotenv.config();

const updatePasswords = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB...');
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);
    
    const result = await Employee.updateMany(
      { password: { $exists: false } },
      { $set: { password: hashedPassword, isDefaultPassword: true } }
    );
    
    console.log(`Successfully updated ${result.modifiedCount} employees.`);
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

updatePasswords();
