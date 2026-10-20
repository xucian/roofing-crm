import {
  DAYS_PER_OPEN_YEAR,
  LEAD_FILTER_YEARS,
  LEAD_PERMIT_GROUPS,
  LEAD_STATUSES,
  RADIUS_MILES,
  formatCoordinates,
  type GeoPoint,
  type LeadPermitGroup,
} from '@roofing-crm/shared';
import { STATUS_GROUP_LABELS } from '../details/format-permit';
import { LEAD_STATUS_LABELS } from './format-lead';
import { EMPTY_LEAD_FILTER, filterRadius, toggle, type LeadFilterDraft } from './lead-filter';

const PERMIT_GROUP_LABELS: Readonly<Record<LeadPermitGroup, string>> = {
  ...STATUS_GROUP_LABELS,
  none: 'No permit',
};

export interface LeadFiltersProps {
  draft: LeadFilterDraft;
  onChange: (draft: LeadFilterDraft) => void;
  /** The map's pin and radius: the radius filter's center, and its radius when none is typed. */
  center: GeoPoint;
  mapRadiusMiles: number;
  /** Whether any field filters (the Clear button). */
  active: boolean;
}

/**
 * The Leads page's filters (docs/decisions.md §5, README demo step "filtering leads by roof age,
 * permit status/open duration, and location radius"). Every change reads the list again from the
 * `leads` function, which applies the filter to each lead's snapshot.
 */
export function LeadFilters({ draft, onChange, center, mapRadiusMiles, active }: LeadFiltersProps) {
  const set = (fields: Partial<LeadFilterDraft>): void => {
    onChange({ ...draft, ...fields });
  };
  return (
    <form
      className="lead-filters"
      aria-label="Filter leads"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <fieldset className="lead-filter-group">
        <legend className="field-label">Status</legend>
        {LEAD_STATUSES.map((status) => (
          <label key={status} className="field-check lead-filter-check">
            <input
              type="checkbox"
              checked={draft.statuses.includes(status)}
              onChange={(event) => {
                set({
                  statuses: toggle(draft.statuses, status, event.target.checked, LEAD_STATUSES),
                });
              }}
            />
            {LEAD_STATUS_LABELS[status]}
          </label>
        ))}
      </fieldset>

      <fieldset className="lead-filter-group">
        <legend className="field-label">Permit</legend>
        {LEAD_PERMIT_GROUPS.map((group) => (
          <label key={group} className="field-check lead-filter-check">
            <input
              type="checkbox"
              checked={draft.permitGroups.includes(group)}
              onChange={(event) => {
                set({
                  permitGroups: toggle(
                    draft.permitGroups,
                    group,
                    event.target.checked,
                    LEAD_PERMIT_GROUPS,
                  ),
                });
              }}
            />
            {PERMIT_GROUP_LABELS[group]}
          </label>
        ))}
      </fieldset>

      <div className="lead-filter-numbers">
        <label className="lead-filter-number">
          <span className="field-label">Roof older than</span>
          <input
            className="field-input"
            type="number"
            inputMode="numeric"
            min={LEAD_FILTER_YEARS.min}
            max={LEAD_FILTER_YEARS.max}
            step={1}
            placeholder="any"
            value={draft.roofAgeMin}
            onChange={(event) => {
              set({ roofAgeMin: event.target.value });
            }}
          />
          <span className="field-unit">years</span>
        </label>
        <label className="lead-filter-number">
          <span className="field-label">Permit open at least</span>
          <input
            className="field-input"
            type="number"
            inputMode="numeric"
            min={LEAD_FILTER_YEARS.min}
            max={LEAD_FILTER_YEARS.max}
            step={1}
            placeholder="any"
            value={draft.openYearsMin}
            onChange={(event) => {
              set({ openYearsMin: event.target.value });
            }}
          />
          <span className="field-unit">years</span>
        </label>
      </div>

      <div className="lead-filter-within">
        <label className="field-check">
          <input
            type="checkbox"
            checked={draft.within}
            onChange={(event) => {
              set({ within: event.target.checked });
            }}
          />
          Near the map&apos;s pin
        </label>
        <span className="field-unit">within</span>
        <input
          className="field-input"
          type="number"
          inputMode="decimal"
          aria-label="Miles from the map's pin"
          min={RADIUS_MILES.min}
          max={RADIUS_MILES.max}
          step={RADIUS_MILES.step}
          placeholder={String(mapRadiusMiles)}
          value={draft.withinMiles}
          disabled={!draft.within}
          onChange={(event) => {
            set({ withinMiles: event.target.value });
          }}
        />
        <span className="field-unit">
          miles of <code>{formatCoordinates(center)}</code>
        </span>
      </div>

      <p className="field-hint">
        Filters read the snapshot saved with each lead. A roof matches when it is older than the
        number given. A permit counts as open N years from N × {DAYS_PER_OPEN_YEAR} days, open or
        stalled, as on the map. The radius is around the map&apos;s pin
        {draft.within ? `, ${String(filterRadius(draft, mapRadiusMiles))} miles` : ''}; move the pin
        on the map to change it.
      </p>
      <button
        type="button"
        className="button button--quiet button--small"
        disabled={!active}
        onClick={() => {
          onChange(EMPTY_LEAD_FILTER);
        }}
      >
        Clear filters
      </button>
    </form>
  );
}
