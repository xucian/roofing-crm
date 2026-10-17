/** A WGS84 position in decimal degrees. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** A longitude/latitude box in decimal degrees. */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A GeoJSON Polygon geometry (RFC 7946): rings of [lon, lat] positions, first ring outer. */
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

/**
 * Mean Earth radius in miles. The pipeline contract measures distances in great-circle miles; the
 * client draws its radius circle on the same sphere. The server decides which rows match, the
 * circle only shows the area.
 */
export const EARTH_RADIUS_MILES = 3958.7613;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Great-circle distance between two points in miles (haversine). */
export function greatCircleMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point reached from `origin` after `distanceMiles` along the initial bearing (degrees from north). */
export function destinationPoint(
  origin: GeoPoint,
  bearingDegrees: number,
  distanceMiles: number,
): GeoPoint {
  const angular = distanceMiles / EARTH_RADIUS_MILES;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.lat);
  const lon1 = toRadians(origin.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDegrees(lat2), lon: ((toDegrees(lon2) + 540) % 360) - 180 };
}

/**
 * A closed ring of `steps` + 1 [lon, lat] positions at `radiusMiles` around `center`, counterclockwise
 * as RFC 7946 asks of exterior rings.
 */
export function circleRing(center: GeoPoint, radiusMiles: number, steps = 96): [number, number][] {
  if (!(radiusMiles > 0)) throw new RangeError('radiusMiles must be positive');
  if (!Number.isInteger(steps) || steps < 8) throw new RangeError('steps must be an integer >= 8');
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i += 1) {
    // Bearings run clockwise from north, so walking them in reverse yields a counterclockwise ring.
    const point = destinationPoint(center, 360 - (i * 360) / steps, radiusMiles);
    ring.push([point.lon, point.lat]);
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

/** The search area as a GeoJSON polygon. */
export function circlePolygon(center: GeoPoint, radiusMiles: number, steps = 96): PolygonGeometry {
  return { type: 'Polygon', coordinates: [circleRing(center, radiusMiles, steps)] };
}

/** True when `point` lies inside `bounds` (edges included). */
export function isWithinBounds(point: GeoPoint, bounds: GeoBounds): boolean {
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lon >= bounds.west &&
    point.lon <= bounds.east
  );
}

/** `value` limited to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `value` rounded to `decimals` decimal places. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
