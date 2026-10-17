import { describe, expect, it } from 'vitest';
import { parseByteRange } from './local-hosting';

describe('parseByteRange', () => {
  it('reads closed, open and suffix ranges', () => {
    expect(parseByteRange('bytes=0-16383', 100_000)).toEqual({ start: 0, end: 16_383 });
    expect(parseByteRange('bytes=99000-', 100_000)).toEqual({ start: 99_000, end: 99_999 });
    expect(parseByteRange('bytes=-500', 100_000)).toEqual({ start: 99_500, end: 99_999 });
  });

  it('clamps an end past the file and rejects starts past it', () => {
    expect(parseByteRange('bytes=10-999999', 100)).toEqual({ start: 10, end: 99 });
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable');
  });

  it('serves the whole file for no, malformed or multiple ranges', () => {
    expect(parseByteRange(undefined, 100)).toBeUndefined();
    expect(parseByteRange('items=0-1', 100)).toBeUndefined();
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBeUndefined();
  });
});
