import type { PropertySummary } from '@roofing-crm/pipeline-client';
import { formatCoordinates, formatMiles } from '@roofing-crm/shared';
import {
  MATCH_REASON_LABELS,
  formatAddress,
  formatCoordinateBasis,
  formatPermitCounts,
  formatRoofAge,
  formatRoofAnchor,
  formatRoofBasis,
  safeHttpUrl,
} from './format-property';

export interface PropertyRowProps {
  property: PropertySummary;
  selected: boolean;
  onSelect: (propertyId: string) => void;
}

/**
 * One matching roof, which opens its detail drawer: why it matched, its roofing permits by status,
 * the roof age with its basis, confidence, anchor, as-of date and caveats, the coordinates and the
 * source record (docs/decisions.md §4 and the 2026-10-17 entry).
 * All text is rendered as text; nothing from the record is interpreted as markup.
 */
export function PropertyRow({ property, selected, onSelect }: PropertyRowProps) {
  const basis = formatRoofBasis(property);
  const anchor = formatRoofAnchor(property.roof_age_anchor);
  const sourceUrl = safeHttpUrl(property.source.url);
  const coordinateBasis = formatCoordinateBasis(property.coordinate_basis);
  const permitCounts = formatPermitCounts(property.roofing_permit_counts);

  return (
    <li
      id={`result-${property.property_id}`}
      className={selected ? 'result-row result-row--selected' : 'result-row'}
    >
      <button
        type="button"
        className="result-select"
        aria-pressed={selected}
        title="Show the property, its permits and owner"
        onClick={() => {
          onSelect(property.property_id);
        }}
      >
        <span className="result-address">{formatAddress(property.address)}</span>
        <span className="result-distance">
          {property.distance_miles !== null && property.distance_miles !== undefined
            ? formatMiles(property.distance_miles)
            : null}
          <span className="result-chevron" aria-hidden="true">
            ›
          </span>
        </span>
      </button>

      {property.match_reasons && property.match_reasons.length > 0 ? (
        <ul className="result-reasons" aria-label="Why it matched">
          {property.match_reasons.map((reason) => (
            <li key={reason} className={`reason reason--${reason}`}>
              {MATCH_REASON_LABELS[reason]}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="result-roof">
        <strong>{formatRoofAge(property)}</strong>
        {basis ? ` · ${basis}` : null}
      </p>
      {permitCounts ? <p className="result-permits">Roofing permits: {permitCounts}</p> : null}
      <p className="result-meta">
        {property.roof_age_confidence} confidence · as of {property.roof_age_as_of}
        {anchor ? ` · anchored on ${anchor}` : null}
      </p>
      {property.roof_age_caveats.length > 0 ? (
        <ul className="result-caveats" aria-label="Roof age caveats">
          {property.roof_age_caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}

      <p className="result-meta">
        {property.lat !== null && property.lon !== null ? (
          <>
            <code>{formatCoordinates({ lat: property.lat, lon: property.lon })}</code>
            {coordinateBasis ? ` (${coordinateBasis})` : null}
          </>
        ) : (
          'No coordinates'
        )}
      </p>
      <p className="result-meta">
        Source:{' '}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
            {property.source.dataset}
          </a>
        ) : (
          property.source.dataset
        )}
        , record {property.source.record_id} · property {property.property_id}
      </p>
    </li>
  );
}
