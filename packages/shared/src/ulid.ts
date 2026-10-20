/** Crockford base32, as ULIDs use it: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 26 characters, the first 10 a millisecond timestamp, the rest random. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

/**
 * A new ULID (https://github.com/ulid/spec): 48 bits of time and 80 random bits from the platform's
 * CSPRNG (`crypto.getRandomValues`, in browsers and Node). Ids minted in the same millisecond are
 * unique but not ordered among themselves, which nothing here relies on.
 */
export function ulid(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`ULID time out of range: ${String(now)}`);
  }
  let time = '';
  let rest = now;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    time = ALPHABET.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  // 16 random bytes, 5 bits used from each: 80 random bits.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(RANDOM_CHARS));
  let random = '';
  for (const byte of bytes) random += ALPHABET.charAt(byte % 32);
  return time + random;
}

/** The millisecond timestamp a ULID was minted at. */
export function ulidTime(id: string): number {
  if (!ULID_PATTERN.test(id)) throw new Error(`Not a ULID: ${id}`);
  let time = 0;
  for (const char of id.slice(0, TIME_CHARS)) time = time * 32 + ALPHABET.indexOf(char);
  return time;
}
