// Nigerian federal public holidays, used to exclude non-working days from
// leave day counts (see controllers/leaveController.js).
//
// Fixed-date and Easter-derived (Christian) holidays are computed exactly.
// Islamic holidays (Eid-el-Fitr, Eid-el-Kabir, Eid-el-Mawlid) follow the
// lunar Hijri calendar and are gazetted by the Nigerian government each
// year — they can't be reliably computed in advance, so they are NOT
// included here. If HR needs those excluded from leave calculations too,
// they'd need to be added as a manual per-year list; flagging this as a
// known limitation rather than guessing wrong dates.

// Meeus/Jones/Butcher algorithm for the Gregorian Easter Sunday.
const computeEasterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const toKey = (date) => date.toISOString().split('T')[0];

// Returns a Set of 'YYYY-MM-DD' strings for every known holiday in `year`.
export const getNigerianHolidays = (year) => {
  const easter = computeEasterSunday(year);
  const dates = [
    new Date(Date.UTC(year, 0, 1)),   // New Year's Day
    addDays(easter, -2),               // Good Friday
    addDays(easter, 1),                // Easter Monday
    new Date(Date.UTC(year, 4, 1)),   // Workers' Day
    new Date(Date.UTC(year, 5, 12)),  // Democracy Day
    new Date(Date.UTC(year, 9, 1)),   // Independence Day
    new Date(Date.UTC(year, 11, 25)), // Christmas Day
    new Date(Date.UTC(year, 11, 26)), // Boxing Day
  ];
  return new Set(dates.map(toKey));
};

export const isNigerianPublicHoliday = (date) => {
  const d = new Date(date);
  return getNigerianHolidays(d.getUTCFullYear()).has(toKey(d));
};
