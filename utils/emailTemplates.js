/**
 * Centralised email templates for HRMS-X
 * Each function returns { subject, html } ready for sendEmail()
 */

// ─── Shared Layout Wrapper ──────────────────────────────────────────────────
const wrap = (body) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">HRMS-X</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              This is an automated notification from HRMS-X. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Helper ─────────────────────────────────────────────────────────────────
const btn = (label, url) =>
  `<a href="${url}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${label}</a>`;

const heading = (text) =>
  `<h2 style="margin:0 0 16px;font-size:20px;color:#1f2937;">${text}</h2>`;

const para = (text) =>
  `<p style="margin:0 0 12px;font-size:15px;color:#4b5563;line-height:1.6;">${text}</p>`;

const badge = (text, color = '#6366f1') =>
  `<span style="display:inline-block;padding:4px 12px;background:${color}15;color:${color};border-radius:6px;font-size:13px;font-weight:600;">${text}</span>`;

const divider = () =>
  `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">`;

// ─── 1. Welcome Tenant ─────────────────────────────────────────────────────
export const welcomeTenant = ({ orgName, adminName, adminEmail }) => ({
  subject: `Welcome to HRMS-X – ${orgName} is set up!`,
  html: wrap(`
    ${heading('Welcome to HRMS-X! 🎉')}
    ${para(`Hi <strong>${adminName}</strong>,`)}
    ${para(`Your organisation <strong>${orgName}</strong> has been successfully registered on HRMS-X.`)}
    ${para('You can now log in to your HR Admin dashboard to start adding employees, configuring departments, and managing your workforce.')}
    ${divider()}
    ${para(`<strong>Login Email:</strong> ${adminEmail}`)}
    ${para('Use the password you set during registration to sign in.')}
  `)
});

// ─── 2. Employee Created ───────────────────────────────────────────────────
export const employeeCreated = ({ employeeName, email, defaultPassword, orgName }) => ({
  subject: `Your HRMS-X account has been created – ${orgName}`,
  html: wrap(`
    ${heading('Welcome aboard! 👋')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your employee account at <strong>${orgName}</strong> has been created on HRMS-X.`)}
    ${divider()}
    ${para(`<strong>Email:</strong> ${email}`)}
    ${para(`<strong>Temporary Password:</strong> <code style="background:#f3f4f6;padding:4px 8px;border-radius:4px;font-size:14px;">${defaultPassword}</code>`)}
    ${divider()}
    ${para('Please log in and change your password as soon as possible.')}
  `)
});

// ─── 3. Leave Requested (sent to HR) ───────────────────────────────────────
export const leaveRequested = ({ employeeName, leaveType, startDate, endDate, workingDays, reason }) => ({
  subject: `New Leave Request – ${employeeName}`,
  html: wrap(`
    ${heading('New Leave Request 📋')}
    ${para(`<strong>${employeeName}</strong> has submitted a leave request.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Type</td><td>${leaveType}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Dates</td><td>${startDate} → ${endDate}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Working Days</td><td>${workingDays}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Reason</td><td>${reason || '—'}</td></tr>
    </table>
    ${divider()}
    ${para('Please log in to review and approve or reject this request.')}
  `)
});

// ─── 4. Leave Status Update (sent to employee) ─────────────────────────────
export const leaveStatusUpdate = ({ employeeName, leaveType, startDate, endDate, status }) => {
  const colorMap = {
    'Manager Approved': '#16a34a',
    'HR Approved': '#16a34a',
    'Rejected': '#dc2626',
    'Processed': '#2563eb',
  };
  return {
    subject: `Leave ${status} – ${leaveType}`,
    html: wrap(`
      ${heading('Leave Request Update')}
      ${para(`Hi <strong>${employeeName}</strong>,`)}
      ${para(`Your <strong>${leaveType}</strong> leave request from <strong>${startDate}</strong> to <strong>${endDate}</strong> has been updated.`)}
      <div style="text-align:center;margin:20px 0;">
        ${badge(status, colorMap[status] || '#6366f1')}
      </div>
    `)
  };
};

// ─── 5. Disciplinary Query Issued ───────────────────────────────────────────
export const disciplinaryQueryIssued = ({ employeeName, caseTitle, deadlineDate }) => ({
  subject: `Disciplinary Query – ${caseTitle}`,
  html: wrap(`
    ${heading('Disciplinary Query Issued ⚠️')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para(`A disciplinary query has been issued regarding: <strong>${caseTitle}</strong>.`)}
    ${para(`You are required to respond by <strong>${deadlineDate}</strong>.`)}
    ${divider()}
    ${para('Please log in to your HRMS-X portal to view the full details and submit your response.')}
  `)
});

// ─── 6. Onboarding Plan Created ─────────────────────────────────────────────
export const onboardingPlanCreated = ({ employeeName, taskCount }) => ({
  subject: `Your Onboarding Plan is Ready`,
  html: wrap(`
    ${heading('Onboarding Plan Created 🚀')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your onboarding plan has been set up with <strong>${taskCount} task${taskCount !== 1 ? 's' : ''}</strong>.`)}
    ${para('Log in to your HRMS-X portal to view your onboarding checklist and get started.')}
  `)
});

// ─── 7. Probation Outcome ───────────────────────────────────────────────────
export const probationOutcome = ({ employeeName, decision, reason, newEndDate }) => {
  const titles = { Confirm: 'Confirmed ✅', Extend: 'Extended 🔄', Terminate: 'Terminated' };
  const colors = { Confirm: '#16a34a', Extend: '#f59e0b', Terminate: '#dc2626' };
  let extra = '';
  if (decision === 'Extend' && newEndDate) {
    extra = para(`Your probation has been extended to <strong>${newEndDate}</strong>.`);
  }
  return {
    subject: `Probation ${decision}ed`,
    html: wrap(`
      ${heading(`Probation ${titles[decision] || decision}`)}
      ${para(`Dear <strong>${employeeName}</strong>,`)}
      <div style="text-align:center;margin:20px 0;">
        ${badge(decision, colors[decision] || '#6366f1')}
      </div>
      ${reason ? para(`<strong>Reason:</strong> ${reason}`) : ''}
      ${extra}
      ${para('Please log in to your HRMS-X portal for more details.')}
    `)
  };
};

// ─── 8. Exit Initiated ──────────────────────────────────────────────────────
export const exitInitiated = ({ employeeName, exitType, lastWorkingDay }) => ({
  subject: `Offboarding Process Initiated`,
  html: wrap(`
    ${heading('Offboarding Process Started')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para(`Your offboarding process has been initiated.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Exit Type</td><td>${exitType || '—'}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Last Working Day</td><td>${lastWorkingDay || '—'}</td></tr>
    </table>
    ${divider()}
    ${para('Please log in to complete your clearance checklist.')}
  `)
});

// ─── 9. Payslip Available ───────────────────────────────────────────────────
export const payslipAvailable = ({ employeeName, period, netPay }) => ({
  subject: `Payslip Available – ${period}`,
  html: wrap(`
    ${heading('Your Payslip is Ready 💰')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your payslip for <strong>${period}</strong> is now available.`)}
    ${divider()}
    ${para(`<strong>Net Pay:</strong> ₦${Number(netPay).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`)}
    ${divider()}
    ${para('Log in to your HRMS-X portal to view the full breakdown.')}
  `)
});

// ─── 10. Redeployment Initiated ─────────────────────────────────────────────
export const redeploymentInitiated = ({ employeeName, fromDept, toDept, toRole, effectiveDate }) => ({
  subject: `Transfer / Redeployment Notice`,
  html: wrap(`
    ${heading('Transfer Notice 🔀')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para('A transfer / redeployment has been initiated for you.')}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">From Department</td><td>${fromDept}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">To Department</td><td>${toDept}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">New Role</td><td>${toRole}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Effective Date</td><td>${effectiveDate}</td></tr>
    </table>
  `)
});

// ─── 11. Redeployment Completed ─────────────────────────────────────────────
export const redeploymentCompleted = ({ employeeName, toDept, toRole }) => ({
  subject: `Transfer Completed`,
  html: wrap(`
    ${heading('Transfer Completed ✅')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para(`Your transfer has been completed. Your records have been updated.`)}
    ${divider()}
    ${para(`<strong>Department:</strong> ${toDept}`)}
    ${para(`<strong>Role:</strong> ${toRole}`)}
  `)
});

// ─── 12. Requisition Status Update ──────────────────────────────────────────
export const requisitionStatusUpdate = ({ employeeName, itemName, status }) => {
  const colorMap = { Approved: '#16a34a', Rejected: '#dc2626', Fulfilled: '#2563eb' };
  return {
    subject: `Requisition ${status} – ${itemName || 'Request'}`,
    html: wrap(`
      ${heading('Requisition Update')}
      ${para(`Hi <strong>${employeeName}</strong>,`)}
      ${para(`Your requisition${itemName ? ' for <strong>' + itemName + '</strong>' : ''} has been updated.`)}
      <div style="text-align:center;margin:20px 0;">
        ${badge(status, colorMap[status] || '#6366f1')}
      </div>
    `)
  };
};

// ─── 13. Ticket Reply ───────────────────────────────────────────────────────
export const ticketReply = ({ recipientName, ticketSubject, senderName, messageSnippet }) => ({
  subject: `New Reply on Ticket – ${ticketSubject}`,
  html: wrap(`
    ${heading('New Reply on Your Ticket 💬')}
    ${para(`Hi <strong>${recipientName}</strong>,`)}
    ${para(`<strong>${senderName}</strong> replied to ticket: <strong>${ticketSubject}</strong>.`)}
    ${divider()}
    <div style="background:#f9fafb;padding:16px;border-radius:8px;border-left:4px solid #6366f1;">
      <p style="margin:0;font-size:14px;color:#4b5563;font-style:italic;">"${messageSnippet}"</p>
    </div>
    ${divider()}
    ${para('Log in to your HRMS-X portal to continue the conversation.')}
  `)
});

// ─── 14. Training Enrolled ──────────────────────────────────────────────────
export const trainingEnrolled = ({ employeeName, courseTitle, courseType, durationHours }) => ({
  subject: `Enrolled in Training – ${courseTitle}`,
  html: wrap(`
    ${heading('Training Enrollment 📚')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`You have been enrolled in the following training course:`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Course</td><td>${courseTitle}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Type</td><td>${courseType || '—'}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Duration</td><td>${durationHours ? durationHours + ' hours' : '—'}</td></tr>
    </table>
  `)
});

// ─── 15. Password Reset Requested ───────────────────────────────────────────
export const passwordResetRequested = ({ name, resetUrl }) => ({
  subject: `Reset your HRMS-X password`,
  html: wrap(`
    ${heading('Reset Your Password 🔒')}
    ${para(`Hi <strong>${name}</strong>,`)}
    ${para('We received a request to reset your HRMS-X password. Click the button below to choose a new one. This link expires in 30 minutes.')}
    <div style="text-align:center;">
      ${btn('Reset Password', resetUrl)}
    </div>
    ${divider()}
    ${para("If you didn't request this, you can safely ignore this email — your password won't be changed.")}
  `)
});

// ─── 16. KPI Self-Review Submitted (sent to manager) ───────────────────────
export const kpiSelfReviewSubmitted = ({ managerName, employeeName, kpiTitle, score }) => ({
  subject: `KPI Self-Review Submitted – ${employeeName}`,
  html: wrap(`
    ${heading('Manager Review Needed 📝')}
    ${para(`Hi <strong>${managerName}</strong>,`)}
    ${para(`<strong>${employeeName}</strong> submitted a self-review and it's waiting on your sign-off.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">KPI</td><td>${kpiTitle}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Self-Rating</td><td>${score}/5</td></tr>
    </table>
    ${divider()}
    ${para('Log in to your HRMS-X portal to submit the manager review.')}
  `)
});

// ─── 17. KPI Manager Review Signed Off (sent to employee) ───────────────────
export const kpiSignedOff = ({ employeeName, kpiTitle, finalScore }) => ({
  subject: `KPI Signed Off – ${kpiTitle}`,
  html: wrap(`
    ${heading('KPI Signed Off ✅')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your manager has completed the review for <strong>${kpiTitle}</strong>.`)}
    <div style="text-align:center;margin:20px 0;">
      ${badge(`Final Score: ${finalScore}/5`, '#16a34a')}
    </div>
    ${para('Log in to your HRMS-X portal to see the full review.')}
  `)
});
