// Money helpers. All amounts are integer paise (₹1 = 100 paise); never floats.

export class MoneyParseError extends Error {
  constructor(
    message: string,
    readonly input: string,
  ) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

/** Rupee multiplier for each accepted unit word (lower-case, trailing '.' stripped). */
const UNITS: Record<string, bigint> = {
  k: 1_000n,
  thousand: 1_000n,
  thousands: 1_000n,
  l: 1_00_000n,
  lac: 1_00_000n,
  lacs: 1_00_000n,
  lakh: 1_00_000n,
  lakhs: 1_00_000n,
  cr: 1_00_00_000n,
  crs: 1_00_00_000n,
  crore: 1_00_00_000n,
  crores: 1_00_00_000n,
};

/** Western units are rejected: "1.5M" is easy to misread in an Indian context. */
const WESTERN_UNITS = new Set(['m', 'mn', 'mil', 'million', 'millions', 'b', 'bn', 'billion']);

const INDIAN_GROUPING = /^\d{1,2}(,\d{2})*,\d{3}$/; // 3,20,000 · 1,50,00,000
const INTERNATIONAL_GROUPING = /^\d{1,3}(,\d{3})+$/; // 320,000

/**
 * Parse a human-entered rupee amount into paise.
 *
 * Accepts: "320000", "₹3,20,000", "Rs. 3,20,000/-", "3.2L", "32 lakh", "32K",
 * "1.5 Cr", "₹1,234.50". Rejects (throws MoneyParseError) anything ambiguous:
 * negative numbers, western units (M/B), odd digit grouping ("3,2000"), more
 * than one number, or precision finer than one paisa.
 */
export function parseInr(input: string): number {
  if (typeof input !== 'string') throw new MoneyParseError('Amount must be text', String(input));
  let s = input.trim().toLowerCase();
  if (s === '') throw new MoneyParseError('Amount is empty', input);
  if (s.startsWith('-') || s.includes('(')) {
    throw new MoneyParseError('Negative amounts are not allowed', input);
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/, '');
  s = s.replace(/\s*\/-$/, '');
  s = s.replace(/\s*(rupees|rs\.?|inr)$/, '');

  const m = /^(\d[\d,]*)(?:\.(\d+))?\s*([a-z]+\.?)?$/.exec(s);
  if (!m) throw new MoneyParseError('Not a recognisable amount', input);
  const intPart = m[1] ?? '';
  const frac = m[2] ?? '';
  const unitRaw = (m[3] ?? '').replace(/\.$/, '');

  if (intPart.includes(',')) {
    if (!INDIAN_GROUPING.test(intPart) && !INTERNATIONAL_GROUPING.test(intPart)) {
      throw new MoneyParseError('Digit grouping is ambiguous', input);
    }
  }

  let rupeeMultiplier = 1n;
  if (unitRaw !== '') {
    if (WESTERN_UNITS.has(unitRaw)) {
      throw new MoneyParseError('Use lakh/crore/K instead of million/billion', input);
    }
    const unit = UNITS[unitRaw];
    if (unit === undefined) throw new MoneyParseError(`Unknown unit "${unitRaw}"`, input);
    rupeeMultiplier = unit;
  }

  const digits = BigInt(intPart.replace(/,/g, '') + frac);
  const scale = 10n ** BigInt(frac.length);
  const numerator = digits * rupeeMultiplier * 100n;
  if (numerator % scale !== 0n) {
    throw new MoneyParseError('Amount is more precise than one paisa', input);
  }
  const paise = numerator / scale;
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyParseError('Amount is too large', input);
  }
  return Number(paise);
}

/** Non-throwing variant for callers that want to report errors themselves. */
export function tryParseInr(
  input: string,
): { ok: true; paise: number } | { ok: false; error: string } {
  try {
    return { ok: true, paise: parseInr(input) };
  } catch (e) {
    if (e instanceof MoneyParseError) return { ok: false, error: e.message };
    throw e;
  }
}

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) throw new RangeError('paise must be a safe integer');
}

/** Group an integer string the Indian way: 1,50,00,000. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+$)/g, ',') + ',' + last3;
}

/**
 * Format paise as rupees with Indian grouping: 32000000 -> "₹3,20,000".
 * Paise are shown only when non-zero ("₹1,234.50"), unless `paise: 'always'`.
 */
export function formatInr(paise: number, opts: { paise?: 'auto' | 'always' } = {}): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const showPaise = opts.paise === 'always' || p !== 0;
  return `${sign}₹${groupIndian(String(rupees))}${showPaise ? '.' + String(p).padStart(2, '0') : ''}`;
}

/**
 * Short form for tight UI: "₹3.2L", "₹1.5Cr", "₹32K", "₹950". Rounded to at
 * most 2 decimals, so never use it where exact figures matter.
 */
export function formatInrCompact(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const rupees = Math.abs(paise) / 100;
  const fmt = (n: number, unit: string) => `${sign}₹${String(Math.round(n * 100) / 100)}${unit}`;
  if (rupees >= 1_00_00_000) return fmt(rupees / 1_00_00_000, 'Cr');
  if (rupees >= 1_00_000) return fmt(rupees / 1_00_000, 'L');
  if (rupees >= 1_000) return fmt(rupees / 1_000, 'K');
  return fmt(rupees, '');
}
