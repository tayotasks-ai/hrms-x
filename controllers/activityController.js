import ActivityLog from '../models/ActivityLog.js';

// Server-day the ping belongs to, as YYYY-MM-DD (UTC) — same convention as attendanceController.js.
const todayStr = () => new Date().toISOString().split('T')[0];

const HEARTBEAT_MINUTES = 5; // matches the frontend tracker's ping interval
// Sanity ceiling so a client bug (e.g. a stuck interval firing in a loop)
// can never report an impossible day. Generous enough for a genuinely long
// remote workday.
const DAILY_CAP_MINUTES = 16 * 60;

// Pure function, unit-tested separately. Given when the employee's last
// accepted ping landed, how many minutes should THIS ping add?
//
// - No prior ping today → count one full heartbeat interval. The frontend
//   only sends a ping after confirming recent real input, so by the time the
//   first ping of the day arrives the employee has, in practice, already
//   been active for roughly one interval.
// - A prior ping exists → count the elapsed time, capped at one heartbeat
//   interval. Capping (rather than trusting raw elapsed time) means a late,
//   duplicate, or resumed-after-sleep ping can never retroactively credit a
//   large idle gap as active time.
export const computePingIncrement = (lastPingAt, now = new Date(), heartbeatMinutes = HEARTBEAT_MINUTES) => {
  if (!lastPingAt) return heartbeatMinutes;
  const elapsedMinutes = (now.getTime() - new Date(lastPingAt).getTime()) / 60000;
  if (elapsedMinutes <= 0) return 0;
  return Math.min(elapsedMinutes, heartbeatMinutes);
};

// POST /api/activity/ping — Employee ESS only.
//
// Called every ~5 minutes by the frontend's heartbeat tracker, and only
// while the HRMS X tab is visible, focused, and the employee has generated
// real mouse/keyboard/scroll input recently (see
// frontend/src/composables/useActivityTracker.js). This is in-app active-
// time tracking — it has no visibility into other apps, other browser tabs,
// or anything outside this tab. The server doesn't just trust the client's
// cadence blindly: computePingIncrement() caps how much any single ping can
// add, and the daily total is capped separately below.
export const pingActivity = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts report activity.' });

    const tid = req.tenantId;
    const empId = req.user._id;
    const date = todayStr();
    const now = new Date();

    const existing = await ActivityLog.findOne({ employeeId: empId, tenantId: tid, date });
    const increment = computePingIncrement(existing?.lastPingAt, now);
    const nextMinutes = Math.min((existing?.activeMinutes || 0) + increment, DAILY_CAP_MINUTES);

    const record = await ActivityLog.findOneAndUpdate(
      { employeeId: empId, tenantId: tid, date },
      {
        $set: { lastPingAt: now, activeMinutes: nextMinutes },
        $setOnInsert: { firstPingAt: now },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: { date, activeMinutes: record.activeMinutes } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/activity/me?days=7 — Employee's own recent active-time history.
// Employees can see exactly what's being recorded about them, same spirit
// as the DSAR "download my data" feature — nothing tracked silently.
export const getMyActivity = async (req, res) => {
  try {
    if (req.userRole !== 'Employee')
      return res.status(403).json({ success: false, message: 'Only employee accounts have activity records.' });

    const days = Math.min(Number(req.query.days) || 7, 31);
    const records = await ActivityLog.find({ employeeId: req.user._id, tenantId: req.tenantId })
      .sort({ date: -1 })
      .limit(days);

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/activity/team?date=YYYY-MM-DD — HR only. Defaults to today.
export const getTeamActivity = async (req, res) => {
  try {
    const date = req.query.date || todayStr();
    const records = await ActivityLog.find({ tenantId: req.tenantId, date })
      .populate({ path: 'employeeId', select: 'name role departmentId', populate: { path: 'departmentId', select: 'name' } })
      .sort({ activeMinutes: -1 });

    res.json({ success: true, data: { date, records } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
