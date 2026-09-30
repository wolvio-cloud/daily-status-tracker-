// Indian financial year (1 Apr – 31 Mar) and IST date helpers.
// Dates are 'YYYY-MM-DD' strings in IST; months are 'YYYY-MM'. IST has no DST,
// so a fixed +05:30 offset is exact.

export type IsoDate = string;
export type IsoMonth = string;
export interface DateRange {
  /** Inclusive start date. */
  from: IsoDate;
  /** Inclusive end date. */
  to: IsoDate;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isIsoMonth(s: string): boolean {
  const m = ISO_MONTH.exec(s);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

function parts(date: IsoDate): { y: number; m: number; d: number } {
  if (!isIsoDate(date)) throw new RangeError(`Invalid date: ${date}`);
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

function toUtcMs(date: IsoDate): number {
  const { y, m, d } = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The calendar date in India at instant `now`. */
export function todayIst(now: Date = new Date()): IsoDate {
  return fromUtcMs(now.getTime() + IST_OFFSET_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function monthOf(date: IsoDate): IsoMonth {
  parts(date);
  return date.slice(0, 7);
}

export function monthRange(month: IsoMonth): DateRange {
  if (!isIsoMonth(month)) throw new RangeError(`Invalid month: ${month}`);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function addMonths(month: IsoMonth, n: number): IsoMonth {
  if (!isIsoMonth(month)) throw new RangeError(`Invalid month: ${month}`);
  const idx = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + n;
  return `${pad(Math.floor(idx / 12), 4)}-${pad((idx % 12) + 1)}`;
}

/** The `n` complete months before the month containing `today`, oldest first. */
export function previousCompleteMonths(today: IsoDate, n: number): IsoMonth[] {
  const current = monthOf(today);
  return Array.from({ length: n }, (_, i) => addMonths(current, i - n));
}

export function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

export interface FinancialYear {
  /** Calendar year in which the FY starts (FY26-27 -> 2026). */
  startYear: number;
  /** e.g. "FY26-27". */
  label: string;
  from: IsoDate;
  to: IsoDate;
}

export function fyLabel(startYear: number): string {
  return `FY${pad(startYear % 100)}-${pad((startYear + 1) % 100)}`;
}

export function fyOf(date: IsoDate): FinancialYear {
  const { y, m } = parts(date);
  const startYear = m >= 4 ? y : y - 1;
  return {
    startYear,
    label: fyLabel(startYear),
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
  };
}

export interface FiscalQuarter extends DateRange {
  fy: FinancialYear;
  /** 1 = Apr–Jun, 2 = Jul–Sep, 3 = Oct–Dec, 4 = Jan–Mar. */
  quarter: 1 | 2 | 3 | 4;
  /** e.g. "Q2 FY26-27". */
  label: string;
}

export function quarterOf(date: IsoDate): FiscalQuarter {
  const fy = fyOf(date);
  const { m } = parts(date);
  const quarter = (Math.floor(((m + 8) % 12) / 3) + 1) as 1 | 2 | 3 | 4;
  const firstMonth = addMonths(`${fy.startYear}-04`, (quarter - 1) * 3);
  return {
    fy,
    quarter,
    label: `Q${quarter} ${fy.label}`,
    from: monthRange(firstMonth).from,
    to: monthRange(addMonths(firstMonth, 2)).to,
  };
}

/** Month-to-date: 1st of the month through `today`. */
export function mtd(today: IsoDate): DateRange {
  return { from: monthRange(monthOf(today)).from, to: today };
}

/** Quarter-to-date (Indian FY quarters). */
export function qtd(today: IsoDate): DateRange {
  return { from: quarterOf(today).from, to: today };
}

/** Financial-year-to-date. */
export function fytd(today: IsoDate): DateRange {
  return { from: fyOf(today).from, to: today };
}
