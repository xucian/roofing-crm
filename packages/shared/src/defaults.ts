import type { GeoBounds, GeoPoint } from './geo';

/** The county the CRM opens on (docs/decisions.md §1, §4). */
export const DEFAULT_COUNTY = {
  name: 'Travis County',
  state: 'TX',
  label: 'Travis County, TX',
  fips: '48453',
} as const;

/** Initial search center: Austin (docs/decisions.md §4). */
export const DEFAULT_CENTER: Readonly<GeoPoint & { label: string }> = {
  lat: 30.2672,
  lon: -97.7431,
  label: 'Austin',
};

/** Search radius in miles: default 5, allowed 0.1 to 25 (docs/decisions.md §4). */
export const RADIUS_MILES = { default: 5, min: 0.1, max: 25, step: 0.1 } as const;

/**
 * Roof-age threshold in years (docs/decisions.md §4). "Older than" is strict on the server:
 * a roof matches when roof_age_years > threshold. 0 drops the age clause. The upper bound is a UI
 * limit only.
 */
export const ROOF_AGE_THRESHOLD_YEARS = { default: 15, min: 0, max: 100, step: 1 } as const;

/**
 * The permit signal (docs/decisions.md §4): properties with an open or stalled roofing permit are
 * listed by default, and a permit open at least 5 years is "long-open" (the contract's
 * `long_open_years`, sent explicitly so the legend and the server agree).
 */
export const PERMIT_SIGNAL = { defaultOn: true, longOpenYears: 5 } as const;

/**
 * Page size of the map's search: the first 500 matches become markers and the list pages through
 * the rest (docs/decisions.md §4 "Scale" and the 2026-10-17 entry; the REST default is 50).
 */
export const MAP_RESULT_LIMIT = 500;

/**
 * The map's extent and the basemap extract's bounding box: Travis County's box (about
 * 30.02 to 30.63 N, -98.17 to -97.37 W) with a margin of about 2 miles. The server decides what is
 * inside the county (its area_note); this box only bounds the basemap and the camera.
 */
export const MAP_BOUNDS: Readonly<GeoBounds> = {
  west: -98.2,
  south: 29.99,
  east: -97.34,
  north: 30.66,
};
