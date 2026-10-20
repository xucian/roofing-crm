import type {
  Meta,
  PermitDetail,
  PermitSummary,
  PropertyDetail,
  PropertySummary,
  SearchCenter,
} from '../client';

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

const FIXTURE_REQUEST = {
  method: 'GET',
  url: 'https://example.org/fixture',
  multiValueQueryString: {},
} as const;

/** An open roofing permit, open 2,000 days, with a printed contractor and BBB blocked. */
export function fixturePermit(n: number, overrides: Partial<PermitSummary> = {}): PermitSummary {
  const id = `FX-${String(n)} BP`;
  return {
    permit_id: id,
    geo_id: null,
    property_id: 'fx-1',
    property_link: { match_method: 'exact', normalization_version: null, confidence: 'exact' },
    permit_type: 'BP',
    permit_class: 'FIXTURE CLASS',
    work_class: 'Repair',
    description: `Fixture re-roof ${String(n)}`,
    roof_work_class: 'primary_roof_replacement',
    work_classifier_version: 'fixture-1',
    is_roofing: true,
    is_reroof: true,
    status: 'Active',
    status_group: 'open',
    status_observed_at: '2026-10-16T00:00:00Z',
    status_source: 'indexed',
    applied_date: '2021-01-01',
    issued_date: '2021-04-01',
    expires_date: '2022-04-01',
    completed_date: null,
    completed_date_evidence: 'unknown',
    open_since: '2021-04-01',
    open_since_basis: 'issued_date',
    open_duration_days: 2000,
    open_duration_basis: 'today',
    open_duration_as_of: '2026-10-20',
    days_since_expiry: null,
    contractor: {
      contractor_attribution_key: `fx-key-${String(n)}`,
      identity_status: 'source_name_attribution',
      printed_name: 'FIXTURE ROOFER',
      company_name: 'FIXTURE ROOFING CO',
      trade: 'General Contractor',
      phone: '000-000-0000',
    },
    bbb: {
      rating: null,
      status: 'blocked',
      incomplete_reason: 'http_403_source_block',
      note: 'Fixture note: BBB blocks scripted access.',
    },
    lat: 30.25,
    lon: -97.75,
    source: {
      dataset: 'fixture-permits',
      record_id: id,
      url: `https://example.org/fixture/permits/${String(n)}`,
      fetched_at: '2026-10-16T00:00:00Z',
      run_id: 'fixture-run',
      request_identifier: id,
      source_http_request: FIXTURE_REQUEST,
    },
    record_cid: `bafyfixturepermit${String(n)}`,
    property_cid: 'bafyfixtureproperty',
    data_group_cid: 'bafyfixturegroup',
    unpublished_source: {
      dataset: 'fixture-permit-export',
      url: 'https://example.org/fixture/export',
      fetched_at: '2026-10-16T00:00:00Z',
      source_http_request: FIXTURE_REQUEST,
      row_sha256: 'f1x7ure0000000000000000000000000000000000000000000000000000000000',
      evidence_state: 'confirmed_present',
      fields: ['description', 'status', 'contractor_full_name'],
    },
    ...overrides,
  };
}

/** A property with an owner and the given permits (by default one open roofing permit). */
export function fixtureDetail(n: number, overrides: Partial<PropertyDetail> = {}): PropertyDetail {
  // A property read by id carries no search fields: no match reasons, no distance.
  const summary = fixtureProperty(n);
  delete summary.match_reasons;
  delete summary.distance_miles;
  const permits = overrides.permits ?? [fixturePermit(1, { property_id: summary.property_id })];
  return {
    ...summary,
    geo_id: `fx-geo-${String(n)}`,
    roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
    unpublished_source: {
      dataset: 'fixture-roll-export',
      url: 'https://example.org/fixture/roll',
      fetched_at: '2026-10-16T00:00:00Z',
      source_http_request: FIXTURE_REQUEST,
      row_sha256: 'f1x7ure1111111111111111111111111111111111111111111111111111111111',
      evidence_state: 'confirmed_present',
      fields: ['geo_id', 'owner_name', 'mailing_address', 'deed_date'],
    },
    owner: {
      owner_name: 'FIXTURE OWNER',
      mailing_address: {
        line1: 'PO BOX 0',
        line2: null,
        city: 'TESTVILLE',
        state: 'TX',
        zip: '00000',
      },
      deed_date: '2001-02-03',
      owner_tenure_years: 25.7,
      owner_absentee: true,
      owner_out_of_area: false,
      source: summary.source,
      unpublished_source: null,
    },
    permits,
    permits_total: permits.length,
    permits_truncated: false,
    ...overrides,
  };
}

/** A permit read by id: the summary plus its embedded property (`fx-1` unless overridden). */
export function fixturePermitDetail(
  n: number,
  overrides: Partial<PermitDetail> = {},
): PermitDetail {
  const summary = fixturePermit(n);
  delete summary.distance_miles;
  const property = fixtureProperty(1, {
    roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
  });
  delete property.match_reasons;
  delete property.distance_miles;
  return {
    ...summary,
    property,
    applicant: null,
    applicant_unavailable_reason: 'not collected: personal contact fields',
    valuations: null,
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
