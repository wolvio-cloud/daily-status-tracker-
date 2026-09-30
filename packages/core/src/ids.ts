// ULID ids: 48-bit ms timestamp + 80 random bits, Crockford base32, 26 chars.
// Sortable by creation time and safe to show in chat/URLs (no amounts, no PII).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type RandomBytes = (n: number) => Uint8Array;

const cryptoRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function ulid(timeMs: number = Date.now(), random: RandomBytes = cryptoRandom): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 2 ** 48 - 1) {
    throw new RangeError('ULID time must be an integer in [0, 2^48)');
  }
  let time = '';
  let t = timeMs;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 16 random bytes, 5 bits each -> 16 chars (80 bits).
  const bytes = random(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ALPHABET[(bytes[i] ?? 0) % 32];
  return time + rand;
}

/** Deterministic byte source for reproducible sample data and tests (mulberry32). */
export function seededRandom(seed: number): RandomBytes {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
}
