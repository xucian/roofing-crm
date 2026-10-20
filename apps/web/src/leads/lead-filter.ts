import {
  LEAD_FILTER_YEARS,
  LEAD_PERMIT_GROUPS,
  LEAD_STATUSES,
  RADIUS_MILES,
  clamp,
  type GeoPoint,
  type LeadFilter,
  type LeadPermitGroup,
  type LeadStatus,
} from '@roofing-crm/shared';

/**
 * What the Leads page's filter bar holds: ticked statuses and permit groups (all ticked filters
 * nothing), and the number fields as typed (empty filters nothing). The radius is around the map's
 * pin; its field left empty means the map's own radius.
 */
export interface LeadFilterDraft {
  statuses: readonly LeadStatus[];
  roofAgeMin: string;
  permitGroups: readonly LeadPermitGroup[];
  openYearsMin: string;
  within: boolean;
  withinMiles: string;
}

export const EMPTY_LEAD_FILTER: LeadFilterDraft = {
  statuses: LEAD_STATUSES,
  roofAgeMin: '',
  permitGroups: LEAD_PERMIT_GROUPS,
  openYearsMin: '',
  within: false,
  withinMiles: '',
};

/** A typed number, clamped to its range; undefined when empty or not a number. */
function parseNumber(
  text: string,
  range: { min: number; max: number },
  integer: boolean,
): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  return clamp(integer ? Math.floor(value) : value, range.min, range.max);
}

/** The radius the filter uses: the typed one, else the map's. */
export function filterRadius(draft: LeadFilterDraft, mapRadiusMiles: number): number {
  return parseNumber(draft.withinMiles, RADIUS_MILES, false) ?? mapRadiusMiles;
}

/** The `leads.list` filter for a draft, or null when it filters nothing. */
export function toLeadFilter(
  draft: LeadFilterDraft,
  center: GeoPoint,
  mapRadiusMiles: number,
): LeadFilter | null {
  const filter: LeadFilter = {};
  if (draft.statuses.length < LEAD_STATUSES.length) {
    filter.statuses = LEAD_STATUSES.filter((status) => draft.statuses.includes(status));
  }
  const roofAgeMin = parseNumber(draft.roofAgeMin, LEAD_FILTER_YEARS, true);
  if (roofAgeMin !== undefined) filter.roof_age_min = roofAgeMin;
  if (draft.permitGroups.length < LEAD_PERMIT_GROUPS.length) {
    filter.permit_groups = LEAD_PERMIT_GROUPS.filter((group) => draft.permitGroups.includes(group));
  }
  const openYearsMin = parseNumber(draft.openYearsMin, LEAD_FILTER_YEARS, true);
  if (openYearsMin !== undefined) filter.open_years_min = openYearsMin;
  if (draft.within) {
    filter.within = {
      lat: center.lat,
      lon: center.lon,
      radius_miles: filterRadius(draft, mapRadiusMiles),
    };
  }
  return Object.keys(filter).length === 0 ? null : filter;
}

/** Ticks or unticks one value of a set of checkboxes, keeping their order. */
export function toggle<T>(values: readonly T[], value: T, on: boolean, order: readonly T[]): T[] {
  return order.filter((item) => (item === value ? on : values.includes(item)));
}
