import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER, MAP_BOUNDS } from './defaults';
import {
  circlePolygon,
  circleRing,
  clamp,
  destinationPoint,
  greatCircleMiles,
  isWithinBounds,
  roundTo,
} from './geo';

/** Twice the signed area of a [lon, lat] ring (shoelace); positive means counterclockwise. */
function signedArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i] ?? [0, 0];
    const [x2, y2] = ring[i + 1] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

describe('greatCircleMiles', () => {
  it('is zero for the same point and symmetric', () => {
    const a = { lat: 30.2672, lon: -97.7431 };
    const b = { lat: 30.4394, lon: -97.62 };
    expect(greatCircleMiles(a, a)).toBe(0);
    expect(greatCircleMiles(a, b)).toBeCloseTo(greatCircleMiles(b, a), 10);
  });

  it('measures one degree of latitude as about 69.1 miles', () => {
    expect(greatCircleMiles({ lat: 30, lon: -97 }, { lat: 31, lon: -97 })).toBeCloseTo(69.09, 1);
  });
});

describe('destinationPoint', () => {
  it('lands at the requested distance on every bearing', () => {
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const point = destinationPoint(DEFAULT_CENTER, bearing, 5);
      expect(greatCircleMiles(DEFAULT_CENTER, point)).toBeCloseTo(5, 6);
    }
  });

  it('moves north on bearing 0 and east on bearing 90', () => {
    const north = destinationPoint(DEFAULT_CENTER, 0, 1);
    const east = destinationPoint(DEFAULT_CENTER, 90, 1);
    expect(north.lat).toBeGreaterThan(DEFAULT_CENTER.lat);
    expect(north.lon).toBeCloseTo(DEFAULT_CENTER.lon, 9);
    expect(east.lon).toBeGreaterThan(DEFAULT_CENTER.lon);
  });
});

describe('circleRing', () => {
  it('is closed, has steps + 1 positions and keeps every vertex at the radius', () => {
    const ring = circleRing(DEFAULT_CENTER, 5, 64);
    expect(ring).toHaveLength(65);
    expect(ring[64]).toEqual(ring[0]);
    for (const [lon, lat] of ring) {
      expect(greatCircleMiles(DEFAULT_CENTER, { lat, lon })).toBeCloseTo(5, 6);
    }
  });

  it('winds counterclockwise as RFC 7946 asks of exterior rings', () => {
    expect(signedArea(circleRing(DEFAULT_CENTER, 2))).toBeGreaterThan(0);
  });

  it('rejects a non-positive radius and too few steps', () => {
    expect(() => circleRing(DEFAULT_CENTER, 0)).toThrow(RangeError);
    expect(() => circleRing(DEFAULT_CENTER, 1, 4)).toThrow(RangeError);
  });

  it('wraps the ring in a GeoJSON polygon', () => {
    const polygon = circlePolygon(DEFAULT_CENTER, 1, 16);
    expect(polygon.type).toBe('Polygon');
    expect(polygon.coordinates).toHaveLength(1);
    expect(polygon.coordinates[0]).toHaveLength(17);
  });
});

describe('bounds and numbers', () => {
  it('places the default center inside the map bounds and a far point outside', () => {
    expect(isWithinBounds(DEFAULT_CENTER, MAP_BOUNDS)).toBe(true);
    expect(isWithinBounds({ lat: 29.4241, lon: -98.4936 }, MAP_BOUNDS)).toBe(false);
  });

  it('includes the edges of the bounds', () => {
    expect(isWithinBounds({ lat: MAP_BOUNDS.north, lon: MAP_BOUNDS.west }, MAP_BOUNDS)).toBe(true);
  });

  it('clamps and rounds', () => {
    expect(clamp(30, 0.1, 25)).toBe(25);
    expect(clamp(0, 0.1, 25)).toBe(0.1);
    expect(clamp(7, 0.1, 25)).toBe(7);
    expect(roundTo(30.267249, 5)).toBe(30.26725);
  });
});
