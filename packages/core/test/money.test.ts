import { describe, expect, it } from 'vitest';
import { MoneyParseError, formatInr, formatInrCompact, parseInr, tryParseInr } from '../src/money';

const RUPEE = 100;

describe('parseInr', () => {
  it.each([
    ['320000', 3_20_000],
    ['₹3,20,000', 3_20_000],
    ['₹ 3,20,000', 3_20_000],
    ['Rs. 3,20,000/-', 3_20_000],
    ['INR 320000', 3_20_000],
    ['320,000', 3_20_000],
    ['3.2L', 3_20_000],
    ['3.2 lakh', 3_20_000],
    ['3.2 Lakhs', 3_20_000],
    ['3.2 lac', 3_20_000],
    ['32K', 32_000],
    ['32k', 32_000],
    ['32 thousand', 32_000],
    ['1.5 Cr', 1_50_00_000],
    ['1.5cr.', 1_50_00_000],
    ['1.5 crore', 1_50_00_000],
    ['1,500 Cr', 1500_00_00_000],
    ['0', 0],
  ])('%s -> ₹%d', (input, rupees) => {
    expect(parseInr(input)).toBe(rupees * RUPEE);
  });

  it('keeps 3.2L, 32L and 3.2 Cr distinct', () => {
    expect(parseInr('3.2L')).toBe(3_20_000 * RUPEE);
    expect(parseInr('32L')).toBe(32_00_000 * RUPEE);
    expect(parseInr('3.2 Cr')).toBe(3_20_00_000 * RUPEE);
    expect(new Set([parseInr('3.2L'), parseInr('32L'), parseInr('3.2 Cr')]).size).toBe(3);
  });

  it('handles paise exactly', () => {
    expect(parseInr('₹1,234.50')).toBe(1_23_450);
    expect(parseInr('0.01')).toBe(1);
    expect(parseInr('1.23456L')).toBe(1_23_456 * RUPEE);
    expect(parseInr('1.2345678L')).toBe(1_23_45_678);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['-5000', 'negative'],
    ['(5000)', 'negative'],
    ['1.5M', 'million'],
    ['2 million', 'million'],
    ['1bn', 'billion'],
    ['3,2000', 'bad grouping'],
    ['32,00,00', 'bad grouping'],
    ['3.2.1', 'two dots'],
    ['3L 20K', 'two numbers'],
    ['3.2 lakhs crore', 'two units'],
    ['1.005', 'sub-paisa'],
    ['1.23456789L', 'sub-paisa'],
    ['abc', 'not a number'],
    ['5 dollars', 'unknown unit'],
    ['$500', 'wrong currency'],
    ['99999999999999999 Cr', 'too large'],
  ])('rejects %j (%s)', (input) => {
    expect(() => parseInr(input)).toThrow(MoneyParseError);
  });

  it('tryParseInr returns an error instead of throwing', () => {
    expect(tryParseInr('3.2L')).toEqual({ ok: true, paise: 3_20_000 * RUPEE });
    const bad = tryParseInr('1.5M');
    expect(bad.ok).toBe(false);
  });
});

describe('formatInr', () => {
  it.each([
    [0, '₹0'],
    [100, '₹1'],
    [99_900, '₹999'],
    [1_000 * RUPEE, '₹1,000'],
    [3_20_000 * RUPEE, '₹3,20,000'],
    [32_00_000 * RUPEE, '₹32,00,000'],
    [1_50_00_000 * RUPEE, '₹1,50,00,000'],
    [1_23_450, '₹1,234.50'],
    [5, '₹0.05'],
    [-3_20_000 * RUPEE, '-₹3,20,000'],
  ])('%d paise -> %s', (paise, expected) => {
    expect(formatInr(paise)).toBe(expected);
  });

  it('can always show paise', () => {
    expect(formatInr(3_20_000 * RUPEE, { paise: 'always' })).toBe('₹3,20,000.00');
  });

  it('round-trips with parseInr', () => {
    for (const s of ['₹3,20,000', '₹1,50,00,000', '₹1,234.50', '₹7']) {
      expect(formatInr(parseInr(s))).toBe(s);
    }
  });

  it('rejects non-integer paise', () => {
    expect(() => formatInr(1.5)).toThrow(RangeError);
  });
});

describe('formatInrCompact', () => {
  it.each([
    [950 * RUPEE, '₹950'],
    [32_000 * RUPEE, '₹32K'],
    [3_20_000 * RUPEE, '₹3.2L'],
    [1_50_00_000 * RUPEE, '₹1.5Cr'],
    [-3_20_000 * RUPEE, '-₹3.2L'],
  ])('%d -> %s', (paise, expected) => {
    expect(formatInrCompact(paise)).toBe(expected);
  });
});
