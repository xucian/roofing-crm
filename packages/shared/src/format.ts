import type { GeoPoint } from './geo';

const COUNT_FORMAT = new Intl.NumberFormat('en-US');
const MILES_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** 12431 -> "12,431". */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

/**
 * The result summary the map and list show, from the API's exact `total` and the rows on screen:
 * "12,431 matches, showing 500" (docs/decisions.md §4 "Scale").
 */
export function formatMatchSummary(total: number, shown: number): string {
  if (total <= 0) return 'No matches';
  const matches = `${formatCount(total)} ${total === 1 ? 'match' : 'matches'}`;
  return shown < total ? `${matches}, showing ${formatCount(shown)}` : matches;
}

/** 5 -> "5 mi", 0.25 -> "0.3 mi". */
export function formatMiles(miles: number): string {
  return `${MILES_FORMAT.format(miles)} mi`;
}

/** "30.26720, -97.74310": copyable, fixed precision, ASCII minus. */
export function formatCoordinates(point: GeoPoint, decimals = 5): string {
  return `${point.lat.toFixed(decimals)}, ${point.lon.toFixed(decimals)}`;
}
