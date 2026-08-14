import { describe, it, expect } from 'vitest';
import { getNigerianHolidays, isNigerianPublicHoliday } from './nigerianHolidays.js';

describe('getNigerianHolidays', () => {
  it('includes all fixed-date holidays for a given year', () => {
    const holidays = getNigerianHolidays(2026);
    expect(holidays.has('2026-01-01')).toBe(true); // New Year
    expect(holidays.has('2026-05-01')).toBe(true); // Workers' Day
    expect(holidays.has('2026-06-12')).toBe(true); // Democracy Day
    expect(holidays.has('2026-10-01')).toBe(true); // Independence Day
    expect(holidays.has('2026-12-25')).toBe(true); // Christmas
    expect(holidays.has('2026-12-26')).toBe(true); // Boxing Day
  });

  it('computes Good Friday and Easter Monday correctly relative to Easter Sunday', () => {
    // Easter Sunday 2026 is 5 April 2026 (independently verifiable).
    const holidays = getNigerianHolidays(2026);
    expect(holidays.has('2026-04-03')).toBe(true); // Good Friday
    expect(holidays.has('2026-04-06')).toBe(true); // Easter Monday
  });

  it('computes a known Easter date for a different year (2025: 20 April)', () => {
    const holidays = getNigerianHolidays(2025);
    expect(holidays.has('2025-04-18')).toBe(true); // Good Friday
    expect(holidays.has('2025-04-21')).toBe(true); // Easter Monday
  });

  it('does not flag an ordinary weekday as a holiday', () => {
    expect(isNigerianPublicHoliday(new Date(Date.UTC(2026, 6, 15)))).toBe(false); // 15 Jul 2026
  });

  it('isNigerianPublicHoliday matches a known fixed-date holiday', () => {
    expect(isNigerianPublicHoliday(new Date(Date.UTC(2026, 0, 1)))).toBe(true);
  });
});
