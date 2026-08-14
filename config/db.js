import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';
import Payslip from '../models/Payslip.js';
import Kpi from '../models/Kpi.js';
import Department from '../models/Department.js';
import PerformanceCycle from '../models/PerformanceCycle.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/antigravity_hrms');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Auto-seed database
    await seedDatabase();
  } catch (error) {
    console.error(`Database connection error: ${error.message}`);
    process.exit(1);
  }
};

const seedDatabase = async () => {
  try {
    // Only seed if the database is completely empty
    const tenantCount = await Tenant.countDocuments();
    if (tenantCount > 0) {
      console.log('Database already has data. Skipping seed. (Run clean db script if you want a fresh DB)');
      return;
    }

    console.log('Seeding database with default multi-tenant HRMS data...');

    // 1. Create Tenants
    const acmeTenant = await Tenant.create({
      name: 'Acme Corporation',
      slug: 'acme'
    });

    const starkTenant = await Tenant.create({
      name: 'Stark Industries',
      slug: 'stark'
    });

    console.log(`Created Tenants: ${acmeTenant.name}, ${starkTenant.name}`);

    // 2. Create Users (HR Admins)
    const acmeAdmin = await User.create({
      name: 'Alice Cooper (HR)',
      email: 'hradmin@acme.com',
      password: 'password123',
      role: 'HR_Admin',
      tenantId: acmeTenant._id
    });

    const starkAdmin = await User.create({
      name: 'Pepper Potts',
      email: 'hradmin@stark.com',
      password: 'password123',
      role: 'HR_Admin',
      tenantId: starkTenant._id
    });

    // 2.5 Create Departments
    const acmeDesign = await Department.create({ name: 'Design', tenantId: acmeTenant._id });
    const acmeEngineering = await Department.create({ name: 'Engineering', tenantId: acmeTenant._id });
    const acmeSales = await Department.create({ name: 'Sales', tenantId: acmeTenant._id });

    const starkResearch = await Department.create({ name: 'Research', tenantId: starkTenant._id });
    const starkOperations = await Department.create({ name: 'Operations', tenantId: starkTenant._id });
    const starkEngineering = await Department.create({ name: 'Engineering', tenantId: starkTenant._id });

    // 3. Helper for relative dates to test milestones (Birthdays & Anniversaries)
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed

    // Create dates in current month for testing milestones
    const birthdayThisMonth = (day, age) => new Date(currentYear - age, currentMonth, day);
    const anniversaryThisMonth = (day, yearsAgo) => new Date(currentYear - yearsAgo, currentMonth, day);
    
    // Create random dates in other months
    const dateOtherMonth = (monthOffset, day, age) => new Date(currentYear - age, (currentMonth + monthOffset) % 12, day);

    // 4. Create Employees for Acme Corporation (Jane Smith is Manager of John Doe and Bob Johnson)
    const janeSmith = await Employee.create({
      name: 'Jane Smith',
      email: 'jane.smith@acme.com',
      role: 'Product Designer',
      departmentId: acmeDesign._id,
      salary: 7200,
      status: 'Active',
      joinDate: dateOtherMonth(3, 10, 1),
      birthDate: birthdayThisMonth(today.getDate() + 1, 26), // Birthday tomorrow!
      tenantId: acmeTenant._id,
      managerId: null,
      password: 'password123',
      isDefaultPassword: true
    });

    const johnDoe = await Employee.create({
      name: 'John Doe',
      email: 'john.doe@acme.com',
      role: 'Senior Software Engineer',
      departmentId: acmeEngineering._id,
      salary: 8500,
      status: 'Active',
      joinDate: anniversaryThisMonth(5, 3), // 3 years ago, this month
      birthDate: birthdayThisMonth(15, 29), // Birthday 15th of this month
      tenantId: acmeTenant._id,
      managerId: janeSmith._id,
      password: 'password123',
      isDefaultPassword: true
    });

    const bobJohnson = await Employee.create({
      name: 'Bob Johnson',
      email: 'bob.johnson@acme.com',
      role: 'Sales Representative',
      departmentId: acmeSales._id,
      salary: 5000,
      status: 'Onboarding',
      joinDate: new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000), // Joined 10 days ago
      birthDate: dateOtherMonth(6, 22, 35),
      tenantId: acmeTenant._id,
      managerId: janeSmith._id,
      password: 'password123',
      isDefaultPassword: true
    });

    const acmeEmployees = [johnDoe, janeSmith, bobJohnson];

    // 5. Create Employees for Stark Industries (Bruce Banner is Manager of Happy Hogan and Peter Parker)
    const bruceBanner = await Employee.create({
      name: 'Bruce Banner',
      email: 'bruce@stark.com',
      role: 'Chief Nuclear Advisor',
      departmentId: starkResearch._id,
      salary: 15000,
      status: 'Active',
      joinDate: dateOtherMonth(8, 15, 6),
      birthDate: dateOtherMonth(11, 18, 52),
      tenantId: starkTenant._id,
      managerId: null,
      password: 'password123',
      isDefaultPassword: true
    });

    const happyHogan = await Employee.create({
      name: 'Happy Hogan',
      email: 'happy@stark.com',
      role: 'Head of Security',
      departmentId: starkOperations._id,
      salary: 9000,
      status: 'Active',
      joinDate: anniversaryThisMonth(today.getDate(), 10), // Anniversary today!
      birthDate: dateOtherMonth(1, 12, 45),
      tenantId: starkTenant._id,
      managerId: bruceBanner._id,
      password: 'password123',
      isDefaultPassword: true
    });

    const peterParker = await Employee.create({
      name: 'Peter Parker',
      email: 'peter@stark.com',
      role: 'Research Intern',
      departmentId: starkEngineering._id,
      salary: 2000,
      status: 'Active',
      joinDate: dateOtherMonth(4, 1, 1),
      birthDate: birthdayThisMonth(today.getDate() + 2, 19), // Birthday in 2 days!
      tenantId: starkTenant._id,
      managerId: bruceBanner._id,
      password: 'password123',
      isDefaultPassword: true
    });

    const starkEmployees = [happyHogan, peterParker, bruceBanner];

    console.log('Created Default Employees with manager reporting structures.');

    // 6. Create Leave Requests
    await Leave.create([
      {
        employeeId: johnDoe._id,
        tenantId: acmeTenant._id,
        type: 'Annual',
        startDate: new Date(currentYear, currentMonth, today.getDate() + 5),
        endDate: new Date(currentYear, currentMonth, today.getDate() + 12),
        status: 'Pending',
        reason: 'Family summer vacation'
      },
      {
        employeeId: janeSmith._id,
        tenantId: acmeTenant._id,
        type: 'Sick',
        startDate: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), // Started 2 days ago
        endDate: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000), // Ends tomorrow
        status: 'HR Approved',
        reason: 'Dental surgery recovery'
      },
      {
        employeeId: peterParker._id,
        tenantId: starkTenant._id,
        type: 'Annual',
        startDate: new Date(currentYear, currentMonth, today.getDate() + 1),
        endDate: new Date(currentYear, currentMonth, today.getDate() + 3),
        status: 'HR Approved',
        reason: 'Field trip / Science expo'
      }
    ]);

    console.log('Created Default Leave Requests');

    // 7. Create Payslips for previous month
    const lastMonthName = new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    
    await Payslip.create([
      {
        employeeId: johnDoe._id,
        tenantId: acmeTenant._id,
        period: lastMonthName,
        basicSalary: 8500,
        allowances: 500,
        deductions: 200,
        netPay: 8800,
        status: 'Paid'
      },
      {
        employeeId: janeSmith._id,
        tenantId: acmeTenant._id,
        period: lastMonthName,
        basicSalary: 7200,
        allowances: 300,
        deductions: 150,
        netPay: 7350,
        status: 'Paid'
      },
      {
        employeeId: happyHogan._id,
        tenantId: starkTenant._id,
        period: lastMonthName,
        basicSalary: 9000,
        allowances: 1000,
        deductions: 500,
        netPay: 9500,
        status: 'Paid'
      }
    ]);

    console.log('Created Default Payslips');

    // 8. Create Performance Cycles, then Default KPIs against them
    const acmeCycle = await PerformanceCycle.create({
      tenantId: acmeTenant._id,
      name: 'Q2 2026 Performance Review',
      startDate: new Date(currentYear, 3, 1),
      endDate: new Date(currentYear, 5, 30),
      status: 'Open'
    });

    const starkCycle = await PerformanceCycle.create({
      tenantId: starkTenant._id,
      name: 'H1 2026 Performance Review',
      startDate: new Date(currentYear, 0, 1),
      endDate: new Date(currentYear, 5, 30),
      status: 'Open'
    });

    const now = new Date();

    await Kpi.create([
      // John Doe (Acme) — two KPIs, one mid-review, one already signed off.
      // Demonstrates a partially-complete cycle: overall rating reflects only what's signed off so far.
      {
        employeeId: johnDoe._id,
        tenantId: acmeTenant._id,
        cycleId: acmeCycle._id,
        title: 'Optimize API Core Latency',
        description: 'Reduce backend endpoint average response times below 20ms.',
        period: 'Q2 2026',
        weight: 60,
        reviewStage: 'Pending Manager-Review',
        selfRating: { score: 4, comment: 'Latency down from 45ms avg to 20ms, one more push planned before cycle close.', submittedAt: now }
      },
      {
        employeeId: johnDoe._id,
        tenantId: acmeTenant._id,
        cycleId: acmeCycle._id,
        title: 'Ship Payment Retry Logic',
        description: 'Add automatic retry with backoff for failed payment webhook deliveries.',
        period: 'Q2 2026',
        weight: 40,
        reviewStage: 'Signed Off',
        selfRating: { score: 4, comment: 'Shipped and tested against 3 failure scenarios.', submittedAt: now },
        managerRating: { score: 5, comment: 'Clean implementation, zero incidents since launch.', submittedAt: now, ratedBy: janeSmith._id, ratedByModel: 'Employee' },
        finalScore: 5
      },
      // Jane Smith (Acme) — fully signed off by HR (she has no manager).
      {
        employeeId: janeSmith._id,
        tenantId: acmeTenant._id,
        cycleId: acmeCycle._id,
        title: 'Design Obsidian Layout System',
        description: 'Complete UI bento box styling grids and dark mode color scheme.',
        period: 'Q2 2026',
        weight: 100,
        reviewStage: 'Signed Off',
        selfRating: { score: 5, comment: 'Delivered ahead of schedule with full dark-mode coverage.', submittedAt: now },
        managerRating: { score: 5, comment: 'Exceptional execution, shipped ahead of schedule.', submittedAt: now, ratedBy: acmeAdmin._id, ratedByModel: 'User' },
        finalScore: 5
      },
      // Peter Parker (Stark) — untouched, default state: awaiting his own self-review.
      {
        employeeId: peterParker._id,
        tenantId: starkTenant._id,
        cycleId: starkCycle._id,
        title: 'Oscorp Competitor Tech Review',
        description: 'Perform a detailed review of Oscorp tech products and scaffolding tools.',
        period: 'H1 2026',
        weight: 100
      },
      // Happy Hogan (Stark) — fully signed off by his manager Bruce Banner.
      {
        employeeId: happyHogan._id,
        tenantId: starkTenant._id,
        cycleId: starkCycle._id,
        title: 'Audit Avengers Security Logs',
        description: 'Review access logs for the main database servers.',
        period: 'H1 2026',
        weight: 100,
        reviewStage: 'Signed Off',
        selfRating: { score: 4, comment: 'Full audit complete, flagged two stale service accounts for rotation.', submittedAt: now },
        managerRating: { score: 4, comment: 'Thorough work, follow-up items already assigned.', submittedAt: now, ratedBy: bruceBanner._id, ratedByModel: 'Employee' },
        finalScore: 4
      }
    ]);

    console.log('Created Performance Cycles and Default Employee KPIs');
    console.log('Database seeding complete! 🎉');
  } catch (error) {
    console.error(`Database seeding failed: ${error.message}`);
  }
};

export default connectDB;
