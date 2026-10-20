import type { Meta, PropertySummary, SearchCenter } from '@roofing-crm/pipeline-client';

// Synthetic records in the pinned contract's shapes, for tests only. Every value is invented
// ("FIXTURE" addresses, "fx-" ids, example.org URLs): no county data is copied into the repository
// (docs/decisions.md §1, §8).

export function fixtureProperty(
  n: number,
  overrides: Partial<PropertySummary> = {},
): PropertySummary {
  const id = `fx-${String(n)}`;
  return {
    property_id: id,
    geo_id: null,
    address: { line1: `${String(n)} FIXTURE ST`, city: 'TESTVILLE', zip: '00000' },
    lat: 30.25 + n / 1000,
    lon: -97.75 + n / 1000,
    coordinate_basis: 'parcel_centroid',
    year_built: 1990,
    roof_year: 1990,
    roof_age_years: 36,
    roof_age_basis: 'year_built',
    roof_age_confidence: 'low',
    roof_age_anchor: { source_field: 'year_built' },
    roof_age_as_of: '2026-10-20',
    roof_age_caveats: ['fixture caveat'],
    last_roofing_permit: null,
    roofing_permit_counts: { open: 0, stalled: 0, closed: 0, needs_review: 0 },
    owner_tenure_years: null,
    owner_absentee: null,
    owner_out_of_area: null,
    has_bbb_contractor: false,
    source: {
      dataset: 'fixture-roll',
      record_id: id,
      url: `https://example.org/fixture/${id}`,
      fetched_at: '2026-10-18T00:00:00Z',
      run_id: 'fixture-run',
      request_identifier: id,
      source_http_request: {
        method: 'GET',
        url: 'https://example.org/fixture',
        multiValueQueryString: {},
      },
    },
    record_cid: 'bafyfixturerecord',
    property_cid: 'bafyfixtureproperty',
    data_group_cid: 'bafyfixturegroup',
    unpublished_source: null,
    distance_miles: n / 10,
    match_reasons: ['aged_roof'],
    ...overrides,
  };
}

export function fixtureCenter(overrides: Partial<SearchCenter> = {}): SearchCenter {
  return {
    name: 'FIXTUREVILLE',
    kind: 'city',
    match_type: 'exact',
    lat: 30.4,
    lon: -97.6,
    parcel_count: 1234,
    basis: 'fixture parcel centroid',
    ...overrides,
  };
}

/** The fields of /v1/meta the footer reads; the rest of the shape is not needed by these tests. */
export function fixtureMeta(): Meta {
  return {
    run: {
      run_id: 'fixture-run',
      started_at: '2026-10-18T00:00:00Z',
      finished_at: '2026-10-19T00:00:00Z',
    },
    manifest_cid: 'bafyfixturemanifestcid0000000000000000000000',
    groups: {
      'county/s0002': { cid: 'bafyfixturegroup2', schema: 'bafyschema', tables: 'bafytables' },
      'county/s0001': { cid: 'bafyfixturegroup1', schema: 'bafyschema', tables: 'bafytables' },
    },
    atlas: null,
  } as unknown as Meta;
}
