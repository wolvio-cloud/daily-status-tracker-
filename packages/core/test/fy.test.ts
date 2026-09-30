import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  fyOf,
  fytd,
  isIsoDate,
  isIsoMonth,
  monthRange,
  mtd,
  previousCompleteMonths,
  qtd,
  quarterOf,
  todayIst,
} from '../src/fy';

describe('FY boundary', () => {
  it('31 Mar belongs to the previous FY, 1 Apr starts the next', () => {
    expect(fyOf('2027-03-31').label).toBe('FY26-27');
    expect(fyOf('2027-04-01').label).toBe('FY27-28');
    expect(fyOf('2026-04-01')).toEqual({
      startYear: 2026,
      label: 'FY26-27',
      from: '2026-04-01',
      to: '2027-03-31',
    });
  });

  it('labels across the century', () => {
    expect(fyOf('2099-12-01').label).toBe('FY99-00');
  });

  it('quarters follow Apr–Jun = Q1 … Jan–Mar = Q4', () => {
    expect(quarterOf('2026-04-01').label).toBe('Q1 FY26-27');
    expect(quarterOf('2026-06-30').quarter).toBe(1);
    expect(quarterOf('2026-07-01').quarter).toBe(2);
    expect(quarterOf('2026-12-31').quarter).toBe(3);
    const q4 = quarterOf('2027-03-31');
    expect(q4.label).toBe('Q4 FY26-27');
    expect([q4.from, q4.to]).toEqual(['2027-01-01', '2027-03-31']);
    expect(quarterOf('2027-04-01').label).toBe('Q1 FY27-28');
  });

  it('MTD / QTD / FYTD ranges', () => {
    expect(mtd('2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(qtd('2026-09-30')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(fytd('2027-03-31')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(fytd('2027-04-01')).toEqual({ from: '2027-04-01', to: '2027-04-01' });
  });
});

describe('IST dates', () => {
  it('uses the Indian calendar date, not UTC', () => {
    // 20:00 UTC on 31 Mar = 01:30 IST on 1 Apr -> new FY.
    expect(todayIst(new Date('2027-03-31T20:00:00Z'))).toBe('2027-04-01');
    expect(todayIst(new Date('2027-03-31T18:29:59Z'))).toBe('2027-03-31');
    expect(todayIst(new Date('2027-03-31T18:30:00Z'))).toBe('2027-04-01');
  });
});

describe('date arithmetic', () => {
  it('validates dates and months', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-01-01')).toBe(false);
    expect(isIsoMonth('2026-12')).toBe(true);
    expect(isIsoMonth('2026-00')).toBe(false);
  });

  it('adds days and months across boundaries', () => {
    expect(addDays('2027-03-31', 1)).toBe('2027-04-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(daysBetween('2026-03-01', '2026-01-01')).toBe(-59);
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('lists previous complete months, oldest first', () => {
    expect(previousCompleteMonths('2026-01-15', 3)).toEqual(['2025-10', '2025-11', '2025-12']);
  });
});
