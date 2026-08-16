import express from 'express';
import { protect, hrOnly } from '../middleware/authMiddleware.js';
import { authLimiter } from '../middleware/rateLimiter.js';

// Controllers
import { getTenants, createTenant } from '../controllers/tenantController.js';
import { getDepartments, createDepartment, updateDepartment, deleteDepartment } from '../controllers/departmentController.js';
import { loginUser, changePassword, forgotPassword, resetPassword, verifyLoginOtp, setTwoFactor, setPrivacyConsent } from '../controllers/authController.js';
import { getDashboardStats } from '../controllers/dashboardController.js';
import { getEmployees, getEmployee, createEmployee, bulkCreateEmployees, updateEmployee, getMe, updateEmployeeManager, getDirectoryLite } from '../controllers/employeeController.js';
import { getLeaves, createLeave, updateLeaveStatus, getLeavePolicy, updateLeavePolicy } from '../controllers/leaveController.js';
import { getPayslips, createPayslip, getPayslipPdf, getRemittanceReport } from '../controllers/payslipController.js';
import { getKpis, createKpi, updateKpi, submitSelfReview, submitManagerReview, getKpiSummary } from '../controllers/kpiController.js';
import { getPerformanceCycles, createPerformanceCycle, updatePerformanceCycle } from '../controllers/performanceCycleController.js';
import { getCompliances, createCompliance, seedDefaults, updateCompliance } from '../controllers/complianceController.js';
import { getDocuments, createDocument, updateDocument } from '../controllers/documentController.js';
import { getOnboardings, createOnboarding, updateOnboardingTask, updateOnboardingStage, addOnboardingTask, deleteOnboarding } from '../controllers/onboardingController.js';
import { getProbations, createProbation, recordOutcome } from '../controllers/probationController.js';
import { getEmploymentHistories, createEmploymentHistory } from '../controllers/employmentHistoryController.js';
import { getRequisitions, createRequisition, updateRequisitionStatus } from '../controllers/requisitionController.js';
import { getRedeployments, createRedeployment, completeRedeployment } from '../controllers/redeploymentController.js';
import { getExitRecords, initiateExit, updateClearanceTask, completeExit } from '../controllers/exitController.js';
import { getCases, createCase, addAction } from '../controllers/disciplinaryController.js';
import { getBenefits, initBenefitRecord, updateBenefit } from '../controllers/benefitController.js';
import { getTickets, createTicket, updateTicket, addMessage } from '../controllers/ticketController.js';
import { getJobArchitecture, createJobFamily, createJobRole } from '../controllers/jobArchitectureController.js';
import { getPositions, createPosition, updatePosition } from '../controllers/positionController.js';
import { getInternalJobs, createInternalJob, applyForJob, referCandidate } from '../controllers/recruitmentController.js';
import { getTrainingCourses, createTrainingCourse, enrollEmployee, updateEnrollmentStatus } from '../controllers/trainingController.js';
import { getShoutouts, createShoutout, reactToShoutout } from '../controllers/shoutoutController.js';
import { clockIn, clockOut, getMyAttendance, getTodayAttendance } from '../controllers/attendanceController.js';
import { getAuditLog } from '../controllers/auditLogController.js';
import { getPaymentSettings, connectPaystack, disconnectPaystack, setDualApproval } from '../controllers/paymentSettingsController.js';
import { getBanks, verifyBankAccount } from '../controllers/bankController.js';
import { payPayslip, payBatch, finalizePayslipPayment } from '../controllers/payslipPaymentController.js';
import { getPayrollApprovals, approvePayrollApproval, rejectPayrollApproval } from '../controllers/payrollApprovalController.js';
import { handlePaystackWebhook } from '../controllers/webhookController.js';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../controllers/notificationController.js';
import { exportMyData, createDsarRequest, getDsarRequests, updateDsarRequest } from '../controllers/dsarController.js';
import { getRetentionSettings, updateRetentionSettings, getRetentionCandidates, anonymizeEmployee } from '../controllers/retentionController.js';
import { pingActivity, getMyActivity, getTeamActivity } from '../controllers/activityController.js';

const router = express.Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ success: true, status: 'ok', message: 'HRMS X API operational.' }));
router.get('/tenants', getTenants);
router.post('/tenants', createTenant);
router.post('/auth/login', authLimiter, loginUser);
router.post('/auth/verify-otp', authLimiter, verifyLoginOtp);
router.post('/auth/forgot-password', authLimiter, forgotPassword);
router.post('/auth/reset-password', authLimiter, resetPassword);
router.post('/webhooks/paystack', handlePaystackWebhook);

// ── All authenticated routes require protect middleware ────────────────────────
router.use(protect);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);

// Auth (authenticated)
router.put('/auth/change-password', changePassword);
router.put('/auth/2fa', setTwoFactor);
router.put('/auth/consent', setPrivacyConsent);

// Shoutouts
router.get('/shoutouts', getShoutouts);
router.post('/shoutouts', createShoutout);
router.put('/shoutouts/:id/react', reactToShoutout);

// Attendance / Clock-in
router.get('/attendance/me', getMyAttendance);
router.post('/attendance/clock-in', clockIn);
router.post('/attendance/clock-out', clockOut);
router.get('/attendance/today', hrOnly, getTodayAttendance);

// Audit Log
router.get('/audit-log', hrOnly, getAuditLog);

// Activity (in-app active-time tracking)
router.post('/activity/ping', pingActivity);
router.get('/activity/me', getMyActivity);
router.get('/activity/team', hrOnly, getTeamActivity);

// Notifications
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markNotificationRead);
router.put('/notifications/read-all', markAllNotificationsRead);

// Payment Settings (Paystack connection)
router.get('/payment-settings', hrOnly, getPaymentSettings);
router.post('/payment-settings/paystack/connect', hrOnly, connectPaystack);
router.delete('/payment-settings/paystack', hrOnly, disconnectPaystack);
router.put('/payment-settings/dual-approval', hrOnly, setDualApproval);

// Employees
router.get('/employees/me', getMe);
router.get('/employees/directory-lite', getDirectoryLite);
router.get('/employees', getEmployees);
router.get('/employees/:id', hrOnly, getEmployee);
router.post('/employees', hrOnly, createEmployee);
router.post('/employees/bulk', hrOnly, bulkCreateEmployees);
router.put('/employees/:id', updateEmployee);          // self-edit or HR — enforced in controller
router.put('/employees/:id/manager', hrOnly, updateEmployeeManager);
router.post('/employees/:id/verify-bank-account', verifyBankAccount); // self-edit or HR — enforced in controller

// Banks (Paystack bank list, for the account-selection dropdown)
router.get('/banks', getBanks);

// Departments
router.get('/departments', getDepartments);
router.post('/departments', hrOnly, createDepartment);
router.put('/departments/:id', hrOnly, updateDepartment);
router.delete('/departments/:id', hrOnly, deleteDepartment);

// Leaves
router.get('/leaves', getLeaves);
router.post('/leaves', createLeave);
router.put('/leaves/:id', updateLeaveStatus); // manager (first sign-off) or HR (final) — enforced in controller
router.get('/leave-policy', getLeavePolicy);
router.put('/leave-policy', hrOnly, updateLeavePolicy);

// Payroll
router.get('/payslips', getPayslips);
router.post('/payslips', hrOnly, createPayslip);
router.get('/payslips/remittance', hrOnly, getRemittanceReport);
router.get('/payslips/:id/pdf', getPayslipPdf);
router.post('/payslips/pay-batch', hrOnly, payBatch);
router.post('/payslips/:id/pay', hrOnly, payPayslip);
router.post('/payslips/:id/pay/finalize', hrOnly, finalizePayslipPayment);

// Payroll Approvals (maker-checker, only relevant when dual approval is on)
router.get('/payroll-approvals', hrOnly, getPayrollApprovals);
router.post('/payroll-approvals/:id/approve', hrOnly, approvePayrollApproval);
router.post('/payroll-approvals/:id/reject', hrOnly, rejectPayrollApproval);

// Data Subject Requests (NDPA access/correction/erasure)
router.get('/employees/me/data-export', exportMyData);   // self only — enforced in controller
router.post('/dsar-requests', createDsarRequest);          // self only — enforced in controller
router.get('/dsar-requests', hrOnly, getDsarRequests);
router.put('/dsar-requests/:id', hrOnly, updateDsarRequest);

// Data Retention
router.get('/retention-settings', hrOnly, getRetentionSettings);
router.put('/retention-settings', hrOnly, updateRetentionSettings);
router.get('/retention/candidates', hrOnly, getRetentionCandidates);
router.post('/employees/:id/anonymize', hrOnly, anonymizeEmployee);

// KPIs / Performance
router.get('/kpis/summary', getKpiSummary);
router.get('/kpis', getKpis);
router.post('/kpis', createKpi);
router.put('/kpis/:id', updateKpi);
router.put('/kpis/:id/self-review', submitSelfReview);
router.put('/kpis/:id/manager-review', submitManagerReview);

router.get('/performance-cycles', getPerformanceCycles);
router.post('/performance-cycles', hrOnly, createPerformanceCycle);
router.put('/performance-cycles/:id', hrOnly, updatePerformanceCycle);

// Compliance Calendar
router.get('/compliance', getCompliances);
router.post('/compliance', hrOnly, createCompliance);
router.post('/compliance/seed-defaults', hrOnly, seedDefaults);
router.put('/compliance/:id', hrOnly, updateCompliance);

// Documents
router.get('/documents', getDocuments);
router.post('/documents', hrOnly, createDocument);
router.put('/documents/:id', hrOnly, updateDocument);

// Onboarding
router.get('/onboarding', getOnboardings);
router.post('/onboarding', hrOnly, createOnboarding);
router.post('/onboarding/:id/task', hrOnly, addOnboardingTask);
router.put('/onboarding/:id/task/:taskId', hrOnly, updateOnboardingTask); // was open to any authenticated role — tightened to HR since task completion is an HR-managed action in this UI
router.put('/onboarding/:id/stage', hrOnly, updateOnboardingStage);
router.delete('/onboarding/:id', hrOnly, deleteOnboarding);

// Probation
router.get('/probation', getProbations);
router.post('/probation', hrOnly, createProbation);
router.put('/probation/:id/outcome', hrOnly, recordOutcome);

// Employment History
router.get('/employment-history', getEmploymentHistories);
router.post('/employment-history', hrOnly, createEmploymentHistory);

// Requisitions
router.get('/requisitions', getRequisitions);
router.post('/requisitions', createRequisition);
router.put('/requisitions/:id', hrOnly, updateRequisitionStatus);

// Redeployments
router.get('/redeployments', hrOnly, getRedeployments);
router.post('/redeployments', hrOnly, createRedeployment);
router.put('/redeployments/:id/complete', hrOnly, completeRedeployment);

// Exit Management
router.get('/exits', hrOnly, getExitRecords);
router.post("/exits", initiateExit);
router.put('/exits/:recordId/tasks/:taskId', hrOnly, updateClearanceTask);
router.put('/exits/:id/complete', hrOnly, completeExit);

// Disciplinary & Grievance
router.get('/disciplinary', hrOnly, getCases);
router.post('/disciplinary', hrOnly, createCase);
router.post('/disciplinary/:id/action', hrOnly, addAction);

// Benefits
router.get('/benefits', getBenefits);
router.post('/benefits', hrOnly, initBenefitRecord);
router.put('/benefits/:id', hrOnly, updateBenefit);

// Helpdesk
router.get('/tickets', getTickets);
router.post('/tickets', createTicket);
router.put('/tickets/:id', updateTicket);
router.post('/tickets/:id/message', addMessage);

// Job Architecture
router.get('/job-architecture', getJobArchitecture);
router.post('/job-architecture/family', hrOnly, createJobFamily);
router.post('/job-architecture/role', hrOnly, createJobRole);

// Position Management
router.get('/positions', hrOnly, getPositions);
router.post('/positions', hrOnly, createPosition);
router.put('/positions/:id', hrOnly, updatePosition);

// Internal Recruitment
router.get('/internal-jobs', getInternalJobs);
router.post('/internal-jobs', hrOnly, createInternalJob);
router.post('/internal-jobs/:id/apply', applyForJob);
router.post('/internal-jobs/:id/refer', referCandidate);

// Training
router.get('/trainings', getTrainingCourses);
router.post('/trainings', hrOnly, createTrainingCourse);
router.post('/trainings/:id/enroll', enrollEmployee);
router.put('/trainings/:id/enrollments/:enrollmentId', hrOnly, updateEnrollmentStatus);

export default router;
