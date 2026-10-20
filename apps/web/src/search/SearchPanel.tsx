import {
  PERMIT_SIGNAL,
  RADIUS_MILES,
  ROOF_AGE_THRESHOLD_YEARS,
  formatCoordinates,
} from '@roofing-crm/shared';
import type { Dispatch, ReactNode } from 'react';
import { NumberField } from './NumberField';
import { centerLabel, type SearchAction, type SearchState } from './search-state';

export interface SearchPanelProps {
  search: SearchState;
  dispatch: Dispatch<SearchAction>;
  locating: boolean;
  onLocate: () => void;
  /** The place box, shown under the center. */
  place?: ReactNode;
}

export function SearchPanel({ search, dispatch, locating, onLocate, place }: SearchPanelProps) {
  return (
    <section className="panel-section" aria-labelledby="search-heading">
      <h2 id="search-heading" className="panel-heading">
        Search area
      </h2>

      <div className="center-summary">
        <div>
          <p className="center-label">{centerLabel(search.centerSource)}</p>
          <p className="center-coordinates">
            <code>{formatCoordinates(search.center)}</code>
          </p>
        </div>
        <button type="button" className="button" onClick={onLocate} disabled={locating}>
          {locating ? 'Locating…' : 'Use my location'}
        </button>
      </div>
      <p className="field-hint">Click the map or drag the pin to move the center.</p>
      {place}

      <NumberField
        id="radius"
        label="Radius"
        value={search.radiusMiles}
        min={RADIUS_MILES.min}
        max={RADIUS_MILES.max}
        step={RADIUS_MILES.step}
        unit="miles"
        onCommit={(miles) => {
          dispatch({ type: 'radius', miles });
        }}
      />
      <input
        className="field-range"
        type="range"
        aria-label="Radius in miles"
        min={RADIUS_MILES.min}
        max={RADIUS_MILES.max}
        step={RADIUS_MILES.step}
        value={search.radiusMiles}
        onChange={(event) => {
          dispatch({ type: 'radius', miles: Number(event.target.value) });
        }}
      />

      <NumberField
        id="roof-age"
        label="Roofs older than"
        value={search.roofAgeMin}
        min={ROOF_AGE_THRESHOLD_YEARS.min}
        max={ROOF_AGE_THRESHOLD_YEARS.max}
        step={ROOF_AGE_THRESHOLD_YEARS.step}
        unit="years"
        hint="Strict: a roof matches when its age is greater than this. 0 lists every property in the radius."
        onCommit={(years) => {
          dispatch({ type: 'roofAgeMin', years });
        }}
      />

      <div className="field">
        <label className="field-check">
          <input
            type="checkbox"
            checked={search.openPermits}
            aria-describedby="open-permits-hint"
            onChange={(event) => {
              dispatch({ type: 'openPermits', on: event.target.checked });
            }}
          />
          Open and stalled roofing permits
        </label>
        <p id="open-permits-hint" className="field-hint">
          Also list properties with an open or expired-unfinished roofing permit, whatever the roof
          age, longest open first. Open {PERMIT_SIGNAL.longOpenYears} years or more is long-open.
        </p>
      </div>

      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          dispatch({ type: 'reset' });
        }}
      >
        Reset to the Austin defaults
      </button>
    </section>
  );
}
