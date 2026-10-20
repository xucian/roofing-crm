import { PERMIT_SIGNAL } from '@roofing-crm/shared';

export interface LegendProps {
  roofAgeMin: number;
  openPermits: boolean;
}

/**
 * The marker colors: the strongest signal of each match (map/layers.ts `resultSignal`); a cluster
 * takes the strongest color inside it.
 */
export function Legend({ roofAgeMin, openPermits }: LegendProps) {
  return (
    <div className="map-legend" role="group" aria-label="Map legend">
      <div className="legend-row">
        <span className="legend-swatch legend-swatch--area" aria-hidden="true" />
        Search radius
      </div>
      {openPermits ? (
        <>
          <div className="legend-row">
            <span className="legend-swatch legend-swatch--long-open" aria-hidden="true" />
            Permit open {PERMIT_SIGNAL.longOpenYears}+ years
          </div>
          <div className="legend-row">
            <span className="legend-swatch legend-swatch--permit" aria-hidden="true" />
            Open or stalled permit
          </div>
        </>
      ) : null}
      <div className="legend-row">
        <span className="legend-swatch legend-swatch--aged" aria-hidden="true" />
        {roofAgeMin > 0
          ? `Roof older than ${String(roofAgeMin)} years`
          : 'Property in the radius (no age filter)'}
      </div>
      <div className="legend-row">
        <span className="legend-swatch legend-swatch--cluster" aria-hidden="true" />
        Several matches: click to zoom in
      </div>
    </div>
  );
}
