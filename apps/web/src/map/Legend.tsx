export function Legend({ roofAgeMin }: { roofAgeMin: number }) {
  return (
    <div className="map-legend" role="group" aria-label="Map legend">
      <div className="legend-row">
        <span className="legend-swatch legend-swatch--area" aria-hidden="true" />
        Search radius
      </div>
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
