import PDFDocument from 'pdfkit';

// Streams a one-page payslip PDF directly to an Express response, styled to
// match the on-screen invoice preview (logo chip, status pill, bordered
// earnings/deductions table, boxed net-pay panel).
//
// Uses "NGN" instead of the ₦ glyph — pdfkit's built-in Helvetica font
// (WinAnsi encoding) doesn't include the Naira sign, so ₦ renders as a
// missing-glyph box if used directly.

const COLORS = {
  ink: '#18181b',       // zinc-900
  sub: '#71717a',       // zinc-500
  faint: '#a1a1aa',     // zinc-400
  line: '#e4e4e7',      // zinc-200
  panel: '#fafafa',     // zinc-50
  headerBg: '#f4f4f5',  // zinc-100
  lime: '#84cc16',      // lime-500
  limeDark: '#3f6212',  // lime-800 (net pay figure)
  limeBadgeBg: '#ecfccb', // lime-100
  limeBadgeText: '#4d7c0f', // lime-700
  draftBg: '#f4f4f5',
  draftText: '#52525b',
  red: '#b91c1c',
  green: '#15803d',
};

const fmt = (n) => Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const initials = (name) => {
  const words = (name || 'Company').trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

export const streamPayslipPdf = (res, payslip, tenantName) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const safeName = (payslip.employeeId?.name || 'Employee').replace(/[^\w\-]+/g, '-');
  const safePeriod = (payslip.period || 'payslip').replace(/[^\w\-]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Payslip-${safeName}-${safePeriod}.pdf"`);
  doc.pipe(res);

  const left = 50, right = 545, width = right - left;

  // ── Header: logo chip + tenant name / PAYSLIP INVOICE + status pill ────
  doc.roundedRect(left, 50, 28, 28, 4).fill(COLORS.lime);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
    .text(initials(tenantName), left, 59, { width: 28, align: 'center' });

  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.ink)
    .text(tenantName || 'Company', left + 38, 53, { width: 260 });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.sub)
    .text('Multi-Tenant SaaS HRMS', left + 38, 71, { width: 260 });

  doc.font('Helvetica-Bold').fontSize(17).fillColor(COLORS.ink)
    .text('PAYSLIP INVOICE', left, 52, { width, align: 'right' });

  const isPaid = payslip.status === 'Paid';
  const badgeText = `PAYMENT STATUS: ${(payslip.status || 'Draft').toUpperCase()}`;
  doc.font('Helvetica-Bold').fontSize(7.5);
  const badgeWidth = doc.widthOfString(badgeText) + 16;
  const badgeX = right - badgeWidth;
  doc.roundedRect(badgeX, 74, badgeWidth, 15, 3).fill(isPaid ? COLORS.limeBadgeBg : COLORS.draftBg);
  doc.fillColor(isPaid ? COLORS.limeBadgeText : COLORS.draftText)
    .text(badgeText, badgeX, 78, { width: badgeWidth, align: 'center' });

  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.faint)
    .text(`Reference: SLIP-${String(payslip._id).slice(-8).toUpperCase()}`, left, 96);

  doc.moveTo(left, 118).lineTo(right, 118).strokeColor(COLORS.line).lineWidth(1).stroke();

  // ── Employee / cycle info ──────────────────────────────────────────────
  const infoTop = 134;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.sub).text('EMPLOYEE DETAILS', left, infoTop, { characterSpacing: 0.5 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text(payslip.employeeId?.name || 'Deleted Employee', left, infoTop + 14);
  doc.font('Helvetica').fontSize(9).fillColor('#3f3f46')
    .text(payslip.employeeId?.role || '', left, infoTop + 32)
    .text(payslip.employeeId?.departmentId?.name ? `${payslip.employeeId.departmentId.name} Department` : '', left, infoTop + 45)
    .text(payslip.employeeId?.email || '', left, infoTop + 58);

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.sub).text('PAYROLL CYCLE', left, infoTop, { width, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text(payslip.period, left, infoTop + 14, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#3f3f46')
    .text(`Status: ${payslip.status}`, left, infoTop + 32, { width, align: 'right' })
    .text(`Generated: ${new Date(payslip.createdAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, left, infoTop + 45, { width, align: 'right' });

  // ── Earnings / deductions table (bordered, 3-column, matching the UI) ──
  let y = infoTop + 90;
  const tableTop = y;
  // Fixed-width, right-aligned numeric columns, computed from the table's
  // right edge inward so they can never overflow past the border.
  const rightPad = 12;
  const col3W = 100, col3 = right - rightPad - col3W;       // Deductions: ends at right-12 (533)
  const col2W = 100, col2 = col3 - 25 - col2W;               // Earnings: ends 25pt left of col3

  const headRowH = 26;
  doc.rect(left, y, width, headRowH).fill(COLORS.headerBg);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.sub)
    .text('DESCRIPTION', left + 12, y + 9)
    .text('EARNINGS', col2, y + 9, { width: col2W, align: 'right' })
    .text('DEDUCTIONS', col3, y + 9, { width: col3W, align: 'right' });
  y += headRowH;

  const tableRow = (label, earning, deduction) => {
    const rowH = 24;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(9.5).fillColor('#3f3f46').text(label, left + 12, y + 7);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.green).text(earning || '-', col2, y + 7, { width: col2W, align: 'right' });
    doc.fillColor(COLORS.red).text(deduction || '-', col3, y + 7, { width: col3W, align: 'right' });
    y += rowH;
  };

  tableRow('Basic Salary', fmt(payslip.basicSalary), null);
  if (payslip.allowances) tableRow('Allowances & Bonuses', `+${fmt(payslip.allowances)}`, null);

  const d = payslip.deductions;
  if (d && typeof d === 'object') {
    if (d.paye) tableRow('PAYE Tax', null, `-${fmt(d.paye)}`);
    if (d.pension) tableRow('Pension (8%)', null, `-${fmt(d.pension)}`);
    if (d.nhf) tableRow('NHF (2.5%)', null, `-${fmt(d.nhf)}`);
    if (d.other) tableRow('Other Deductions', null, `-${fmt(d.other)}`);
  } else if (d) {
    tableRow('Deductions', null, `-${fmt(d)}`);
  }

  doc.rect(left, tableTop, width, y - tableTop).strokeColor(COLORS.line).lineWidth(1).stroke();

  // ── Net disbursement panel ──────────────────────────────────────────────
  y += 20;
  const panelH = 46;
  doc.roundedRect(left, y, width, panelH, 4).fillAndStroke(COLORS.panel, COLORS.line);
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.sub).text('NET DISBURSEMENT', left + 14, y + 10, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.sub).text('Amount credited to account', left + 14, y + 24);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.limeDark)
    .text(`NGN ${fmt(payslip.netPay)}`, left, y + 13, { width: width - 14, align: 'right' });

  y += panelH + 40;
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.faint)
    .text(`This is a system-generated document and requires no physical signature. Scoped for ${tenantName || 'this organisation'}.`, left, y, { width, align: 'center' });

  doc.end();
};
