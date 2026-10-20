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

const DAYS_PER_YEAR = 365.25;
const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
const YEARS_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

const plural = (value: number, unit: string): string =>
  `${formatCount(value)} ${unit}${value === 1 ? '' : 's'}`;

/**
 * A permit's open duration or time since expiry, from the API's day count: "12 days",
 * "7 months", "5.2 years", "45 years" (whole years from 10 on).
 */
export function formatDays(days: number): string {
  if (days < 60) return plural(Math.max(0, Math.round(days)), 'day');
  if (days < 2 * DAYS_PER_YEAR) return plural(Math.floor(days / DAYS_PER_MONTH), 'month');
  const years = days / DAYS_PER_YEAR;
  if (years >= 10) return plural(Math.floor(years), 'year');
  const rounded = Math.floor(years * 10) / 10;
  return `${YEARS_FORMAT.format(rounded)} years`;
}
