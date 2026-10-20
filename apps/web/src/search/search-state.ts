import {
  DEFAULT_CENTER,
  MAP_BOUNDS,
  PERMIT_SIGNAL,
  RADIUS_MILES,
  ROOF_AGE_THRESHOLD_YEARS,
  clamp,
  isWithinBounds,
  roundTo,
  type GeoPoint,
} from '@roofing-crm/shared';

/** Where the search center came from; decides whether the camera follows it. */
export type CenterSource = 'default' | 'link' | 'pin' | 'gps' | 'place';

export interface SearchState {
  center: GeoPoint;
  centerSource: CenterSource;
  radiusMiles: number;
  /** Strict threshold: a roof matches when its age is greater than this. */
  roofAgeMin: number;
  /** Also match properties with an open or stalled roofing permit (on by default, §4). */
  openPermits: boolean;
}

export type SearchAction =
  | { type: 'pin'; point: GeoPoint }
  | { type: 'gps'; point: GeoPoint }
  /** A search center chosen in the place box (`/v1/search-centers`). */
  | { type: 'place'; point: GeoPoint }
  /** Puts back an earlier center, e.g. when the server says a GPS fix is outside the county. */
  | { type: 'restore'; center: GeoPoint; centerSource: CenterSource }
  | { type: 'radius'; miles: number }
  | { type: 'roofAgeMin'; years: number }
  | { type: 'openPermits'; on: boolean }
  | { type: 'reset' };

/**
 * The search that runs on load (docs/decisions.md §4): Austin, 5 miles, roofs older than 15 years
 * or an open or stalled roofing permit.
 */
export const DEFAULT_SEARCH: SearchState = {
  center: { lat: DEFAULT_CENTER.lat, lon: DEFAULT_CENTER.lon },
  centerSource: 'default',
  radiusMiles: RADIUS_MILES.default,
  roofAgeMin: ROOF_AGE_THRESHOLD_YEARS.default,
  openPermits: PERMIT_SIGNAL.defaultOn,
};

const COORDINATE_DECIMALS = 5;

/** Radius within 0.1 to 25 miles at 0.1 mile steps; anything unreadable becomes the default. */
export function normalizeRadius(miles: number): number {
  if (!Number.isFinite(miles)) return RADIUS_MILES.default;
  return roundTo(clamp(miles, RADIUS_MILES.min, RADIUS_MILES.max), 1);
}

/** Whole years within the UI bounds; anything unreadable becomes the default. */
export function normalizeRoofAgeMin(years: number): number {
  if (!Number.isFinite(years)) return ROOF_AGE_THRESHOLD_YEARS.default;
  return Math.round(clamp(years, ROOF_AGE_THRESHOLD_YEARS.min, ROOF_AGE_THRESHOLD_YEARS.max));
}

function normalizePoint(point: GeoPoint): GeoPoint {
  return {
    lat: roundTo(point.lat, COORDINATE_DECIMALS),
    lon: roundTo(point.lon, COORDINATE_DECIMALS),
  };
}

const readNumber = (params: URLSearchParams, key: string): number => {
  const raw = params.get(key);
  return raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
};

/** `permits=0` turns the permit signal off and `permits=1` on; anything else keeps the default. */
function readPermits(params: URLSearchParams): boolean {
  const raw = params.get('permits');
  if (raw === '0') return false;
  if (raw === '1') return true;
  return PERMIT_SIGNAL.defaultOn;
}

/**
 * Reads `?lat=&lon=&radius=&age=&permits=` so a search can be shared or handed over as one URL. A
 * center outside the map's extent, or half a center, falls back to Austin.
 */
export function parseSearchParams(params: URLSearchParams): SearchState {
  const lat = readNumber(params, 'lat');
  const lon = readNumber(params, 'lon');
  const linked =
    Number.isFinite(lat) && Number.isFinite(lon) && isWithinBounds({ lat, lon }, MAP_BOUNDS);
  return {
    center: linked ? normalizePoint({ lat, lon }) : DEFAULT_SEARCH.center,
    centerSource: linked ? 'link' : 'default',
    radiusMiles: normalizeRadius(params.has('radius') ? readNumber(params, 'radius') : Number.NaN),
    roofAgeMin: normalizeRoofAgeMin(params.has('age') ? readNumber(params, 'age') : Number.NaN),
    openPermits: readPermits(params),
  };
}

export function toSearchParams(state: SearchState): URLSearchParams {
  return new URLSearchParams({
    lat: state.center.lat.toFixed(COORDINATE_DECIMALS),
    lon: state.center.lon.toFixed(COORDINATE_DECIMALS),
    radius: String(state.radiusMiles),
    age: String(state.roofAgeMin),
    permits: state.openPermits ? '1' : '0',
  });
}

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'pin':
      return { ...state, center: normalizePoint(action.point), centerSource: 'pin' };
    case 'gps':
      return { ...state, center: normalizePoint(action.point), centerSource: 'gps' };
    case 'place':
      return { ...state, center: normalizePoint(action.point), centerSource: 'place' };
    case 'restore':
      return { ...state, center: normalizePoint(action.center), centerSource: action.centerSource };
    case 'radius':
      return { ...state, radiusMiles: normalizeRadius(action.miles) };
    case 'roofAgeMin':
      return { ...state, roofAgeMin: normalizeRoofAgeMin(action.years) };
    case 'openPermits':
      return { ...state, openPermits: action.on };
    case 'reset':
      return DEFAULT_SEARCH;
  }
}

/** How the panel names the current center. */
export function centerLabel(source: CenterSource): string {
  switch (source) {
    case 'default':
      return `${DEFAULT_CENTER.label} (default center)`;
    case 'link':
      return 'Center from the link';
    case 'pin':
      return 'Dropped pin';
    case 'gps':
      return 'Your location';
    case 'place':
      return 'Place from the search box';
  }
}
