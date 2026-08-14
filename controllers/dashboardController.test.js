import { describe, it, expect } from 'vitest';
import { buildMonthlyMilestones } from './dashboardController.js';

describe('buildMonthlyMilestones', () => {
  const today = new Date(2026, 7, 14); // 14 August 2026

  it('includes a birthday falling in the current month, any year', () => {
    const employees = [{ name: 'Ada Obi', role: 'Engineer', birthDate: new Date(1995, 7, 20) }];
    const result = buildMonthlyMilestones(employees, today);
    expect(result).toEqual([{ type: 'Birthday', name: 'Ada Obi', role: 'Engineer', date: 20, detail: 'Birthday' }]);
  });

  it('includes a work anniversary and computes years correctly', () => {
    const employees = [{ name: 'Bola Ade', role: 'Analyst', joinDate: new Date(2021, 7, 5) }];
    const result = buildMonthlyMilestones(employees, today);
    expect(result).toEqual([{ type: 'Anniversary', name: 'Bola Ade', role: 'Analyst', date: 5, detail: '5 years' }]);
  });

  it('excludes a join date in the current month of the current year (not yet a full year)', () => {
    const employees = [{ name: 'Chidi Eze', role: 'Intern', joinDate: new Date(2026, 7, 1) }];
    expect(buildMonthlyMilestones(employees, today)).toEqual([]);
  });

  it('excludes birthdays and anniversaries outside the current month', () => {
    const employees = [
      { name: 'Deji Ola', role: 'Manager', birthDate: new Date(1990, 2, 10) },
      { name: 'Efe Uko', role: 'Manager', joinDate: new Date(2019, 10, 3) },
    ];
    expect(buildMonthlyMilestones(employees, today)).toEqual([]);
  });

  it('sorts mixed birthdays and anniversaries by day of month', () => {
    const employees = [
      { name: 'Late Person', role: 'A', birthDate: new Date(1990, 7, 28) },
      { name: 'Early Person', role: 'B', joinDate: new Date(2022, 7, 3) },
    ];
    const result = buildMonthlyMilestones(employees, today);
    expect(result.map(r => r.name)).toEqual(['Early Person', 'Late Person']);
  });

  it('uses singular "year" for a first anniversary', () => {
    const employees = [{ name: 'One Year', role: 'A', joinDate: new Date(2025, 7, 9) }];
    const result = buildMonthlyMilestones(employees, today);
    expect(result[0].detail).toBe('1 year');
  });
});
