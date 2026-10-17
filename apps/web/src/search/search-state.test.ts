import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH,
  centerLabel,
  normalizeRadius,
  normalizeRoofAgeMin,
  parseSearchParams,
  searchReducer,
  toSearchParams,
} from './search-state';

describe('defaults', () => {
  it('opens on Austin, 5 miles, older than 15 years (docs/decisions.md §4)', () => {
    expect(DEFAULT_SEARCH).toEqual({
      center: { lat: 30.2672, lon: -97.7431 },
      centerSource: 'default',
      radiusMiles: 5,
      roofAgeMin: 15,
    });
  });
});

describe('parseSearchParams', () => {
  it('reads a shared link', () => {
    expect(
      parseSearchParams(new URLSearchParams('lat=30.4394&lon=-97.62&radius=2.5&age=20')),
    ).toEqual({
      center: { lat: 30.4394, lon: -97.62 },
      centerSource: 'link',
      radiusMiles: 2.5,
      roofAgeMin: 20,
    });
  });

  it('falls back to Austin for a missing, partial or out-of-area center', () => {
    expect(parseSearchParams(new URLSearchParams('')).centerSource).toBe('default');
    expect(parseSearchParams(new URLSearchParams('lat=30.3')).center).toEqual(
      DEFAULT_SEARCH.center,
    );
    expect(parseSearchParams(new URLSearchParams('lat=29.42&lon=-98.49')).centerSource).toBe(
      'default',
    );
    expect(parseSearchParams(new URLSearchParams('lat=abc&lon=-97.7')).centerSource).toBe(
      'default',
    );
  });

  it('clamps the radius and the threshold and ignores junk', () => {
    const state = parseSearchParams(new URLSearchParams('radius=80&age=-3'));
    expect(state.radiusMiles).toBe(25);
    expect(state.roofAgeMin).toBe(0);
    expect(parseSearchParams(new URLSearchParams('radius=x&age=')).radiusMiles).toBe(5);
    expect(parseSearchParams(new URLSearchParams('age=')).roofAgeMin).toBe(15);
  });

  it('round-trips through toSearchParams', () => {
    const state = searchReducer(DEFAULT_SEARCH, {
      type: 'pin',
      point: { lat: 30.512345678, lon: -97.689 },
    });
    const params = toSearchParams(state);
    expect(params.toString()).toBe('lat=30.51235&lon=-97.68900&radius=5&age=15');
    expect(parseSearchParams(params).center).toEqual(state.center);
  });
});

describe('searchReducer', () => {
  it('moves the center from a pin or GPS and records the source', () => {
    const pinned = searchReducer(DEFAULT_SEARCH, { type: 'pin', point: { lat: 30.3, lon: -97.8 } });
    expect(pinned.centerSource).toBe('pin');
    const located = searchReducer(pinned, { type: 'gps', point: { lat: 30.31, lon: -97.81 } });
    expect(located).toMatchObject({ centerSource: 'gps', center: { lat: 30.31, lon: -97.81 } });
  });

  it('normalizes radius and threshold, and resets to the defaults', () => {
    const changed = searchReducer(searchReducer(DEFAULT_SEARCH, { type: 'radius', miles: 0.04 }), {
      type: 'roofAgeMin',
      years: 22.6,
    });
    expect(changed.radiusMiles).toBe(0.1);
    expect(changed.roofAgeMin).toBe(23);
    expect(searchReducer(changed, { type: 'reset' })).toEqual(DEFAULT_SEARCH);
  });

  it('rounds the radius to tenths and maps unreadable values to the defaults', () => {
    expect(normalizeRadius(3.14159)).toBe(3.1);
    expect(normalizeRadius(Number.NaN)).toBe(5);
    expect(normalizeRoofAgeMin(Number.POSITIVE_INFINITY)).toBe(15);
  });
});

describe('centerLabel', () => {
  it('names each source', () => {
    expect(centerLabel('default')).toBe('Austin (default center)');
    expect(centerLabel('pin')).toBe('Dropped pin');
    expect(centerLabel('gps')).toBe('Your location');
    expect(centerLabel('link')).toBe('Center from the link');
  });
});
