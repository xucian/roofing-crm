import type {
  MatchReason,
  PropertySummary,
  RoofAgeAnchor,
  RoofAgeBasis,
} from '@roofing-crm/pipeline-client';

/** Why a row matched (`match_reasons`), in the CRM's words. */
export const MATCH_REASON_LABELS: Readonly<Record<MatchReason, string>> = {
  aged_roof: 'Aged roof',
  open_roofing_permit: 'Open roofing permit',
  long_open_roofing_permit: 'Long-open roofing permit',
  stalled_roofing_permit: 'Stalled roofing permit',
  owner_tenure: 'Long owner tenure',
  absentee_owner: 'Absentee owner',
  out_of_area_owner: 'Out-of-area owner',
};

/** What the roof's age counts from (the contract's roof-age rule, docs/decisions.md 2026-10-17). */
export const ROOF_AGE_BASIS_LABELS: Readonly<Record<RoofAgeBasis, string>> = {
  completed_replacement: 'completed roof replacement',
  new_construction: 'completed new construction',
  year_built: 'year built on the appraisal roll',
};

type Address = PropertySummary['address'];

/** "1 MAIN ST, AUSTIN 78701", as the roll prints it; the parts it lacks are left out. */
export function formatAddress(address: Address): string {
  const place = [address.city, address.zip].filter(Boolean).join(' ');
  const line = address.line1 ?? 'No situs address on the roll';
  return place ? `${line}, ${place}` : line;
}

/** "Roof 32 years old" or "Roof age unknown". */
export function formatRoofAge(property: Pick<PropertySummary, 'roof_age_years'>): string {
  const years = property.roof_age_years;
  if (years === null) return 'Roof age unknown';
  return `Roof ${String(years)} ${years === 1 ? 'year' : 'years'} old`;
}

/** "since 1993, year built on the appraisal roll", or null when the pipeline has no basis. */
export function formatRoofBasis(
  property: Pick<PropertySummary, 'roof_age_basis' | 'roof_year'>,
): string | null {
  if (property.roof_age_basis === null) return null;
  const basis = ROOF_AGE_BASIS_LABELS[property.roof_age_basis];
  return property.roof_year === null ? basis : `since ${String(property.roof_year)}, ${basis}`;
}

/** The record the age is anchored on: a permit and its date, or the roll's year built. */
export function formatRoofAnchor(anchor: RoofAgeAnchor | null): string | null {
  if (anchor === null) return null;
  if ('permit_id' in anchor) {
    return `permit ${anchor.permit_id}, ${anchor.date_field.replaceAll('_', ' ')} ${anchor.date}`;
  }
  return 'the year built printed on the appraisal roll';
}

export function formatCoordinateBasis(basis: PropertySummary['coordinate_basis']): string | null {
  switch (basis) {
    case 'parcel_centroid':
      return 'parcel centroid';
    case 'permit':
      return "a permit's location";
    case null:
      return null;
  }
}

/** "1 open, 2 closed": the property's roofing permits by group, or null when it has none. */
export function formatPermitCounts(
  counts: PropertySummary['roofing_permit_counts'],
): string | null {
  const parts = [
    { count: counts.open, label: 'open' },
    { count: counts.stalled, label: 'stalled' },
    { count: counts.closed, label: 'closed' },
    { count: counts.needs_review, label: 'need review' },
  ]
    .filter((part) => part.count > 0)
    .map((part) => `${String(part.count)} ${part.label}`);
  return parts.length === 0 ? null : parts.join(', ');
}

/** Only http(s) links are rendered; anything else stays plain text. */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
