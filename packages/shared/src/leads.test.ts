import { describe, expect, it } from 'vitest';
import {
  CREATE_MANY_MAX,
  CreateLeadInputSchema,
  CreateManyLeadsInputSchema,
  DeleteLeadInputSchema,
  LEAD_NOTE_MAX,
  LeadFilterSchema,
  LeadSnapshotSchema,
  ListLeadsInputSchema,
  UpdateLeadInputSchema,
  isEmptyLeadFilter,
  leadKey,
  leadPermitGroup,
  matchesLeadFilter,
  type Lead,
  type LeadFilter,
  type LeadPermitSnapshot,
} from './leads';
import { ULID_PATTERN, ulid, ulidTime } from './ulid';

const WORKSPACE = '01JBQ7Z0000000000000000000';

describe('ulid', () => {
  it('mints 26 Crockford base32 characters that carry their time', () => {
    const id = ulid(1_760_000_000_000);
    expect(id).toMatch(ULID_PATTERN);
    expect(ulidTime(id)).toBe(1_760_000_000_000);
  });

  it('is random after the time part', () => {
    const ids = new Set(Array.from({ length: 200 }, () => ulid(0)));
    expect(ids.size).toBe(200);
  });

  it('refuses times a ULID cannot hold', () => {
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(2 ** 48)).toThrow(RangeError);
  });
});

describe('lead inputs', () => {
  it('defaults the permit to empty: a property-only lead', () => {
    expect(CreateLeadInputSchema.parse({ workspace_id: WORKSPACE, property_id: '103857' })).toEqual(
      { workspace_id: WORKSPACE, property_id: '103857', permit_id: '' },
    );
  });

  it('keeps the space inside a permit number', () => {
    const input = CreateLeadInputSchema.parse({
      workspace_id: WORKSPACE,
      property_id: '103857',
      permit_id: ' 2019-012345 BP ',
    });
    expect(input.permit_id).toBe('2019-012345 BP');
  });

  it('refuses a workspace that is not a ULID, and ids that would break the sort key', () => {
    const base = { workspace_id: WORKSPACE, property_id: '1' };
    expect(CreateLeadInputSchema.safeParse({ ...base, workspace_id: 'mine' }).success).toBe(false);
    expect(CreateLeadInputSchema.safeParse({ ...base, property_id: 'a#b' }).success).toBe(false);
    expect(CreateLeadInputSchema.safeParse({ ...base, property_id: '' }).success).toBe(false);
    expect(CreateLeadInputSchema.safeParse({ ...base, permit_id: 'x\ny' }).success).toBe(false);
  });

  it(`takes 1 to ${String(CREATE_MANY_MAX)} rows at once`, () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ property_id: String(i) }));
    const parse = (n: number) =>
      CreateManyLeadsInputSchema.safeParse({ workspace_id: WORKSPACE, rows: rows(n) }).success;
    expect(parse(0)).toBe(false);
    expect(parse(1)).toBe(true);
    expect(parse(CREATE_MANY_MAX)).toBe(true);
    expect(parse(CREATE_MANY_MAX + 1)).toBe(false);
  });

  it('pages the list 100 at a time by default, at most 200', () => {
    expect(ListLeadsInputSchema.parse({ workspace_id: WORKSPACE }).limit).toBe(100);
    expect(ListLeadsInputSchema.safeParse({ workspace_id: WORKSPACE, limit: 201 }).success).toBe(
      false,
    );
  });

  it('keys a lead by property and permit', () => {
    expect(leadKey({ property_id: '1', permit_id: 'A 1' })).toBe('1#A 1');
    expect(leadKey({ property_id: '1', permit_id: '' })).toBe('1#');
    expect(leadKey({ property_id: '1' })).toBe('1#');
  });
});

describe('lead snapshot', () => {
  const snapshot = {
    taken_at: '2026-10-20T12:00:00.000Z',
    run_id: 'fixture-run',
    address: { line1: '1 FIXTURE ST', city: 'TESTVILLE', zip: '00000' },
    lat: 30.25,
    lon: -97.75,
    roof_age_years: 36,
    roof_year: 1990,
    roof_age_basis: 'year_built',
    roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
    permit: null,
  };

  it('accepts a property lead without a permit', () => {
    expect(LeadSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('bounds third-party text', () => {
    const long = {
      ...snapshot,
      permit: {
        permit_id: 'FX-1 BP',
        basis: 'saved',
        status_group: 'open',
        status: 'Active',
        roof_work_class: 'primary_roof_replacement',
        open_since: '2021-04-01',
        open_duration_days: 2000,
        days_since_expiry: null,
        contractor_name: 'x'.repeat(201),
        bbb_status: 'blocked',
        bbb_rating: null,
      },
    };
    expect(LeadSnapshotSchema.safeParse(long).success).toBe(false);
  });
});

describe('lead edits', () => {
  const lead = { workspace_id: WORKSPACE, property_id: '1', permit_id: 'A 1' };

  it('sets a status, a note or both, and nothing else', () => {
    expect(UpdateLeadInputSchema.parse({ ...lead, status: 'working' })).toEqual({
      ...lead,
      status: 'working',
    });
    expect(UpdateLeadInputSchema.parse({ ...lead, note: '' }).note).toBe('');
    expect(UpdateLeadInputSchema.safeParse(lead).success).toBe(false);
    expect(UpdateLeadInputSchema.safeParse({ ...lead, status: 'won' }).success).toBe(false);
    expect(UpdateLeadInputSchema.parse({ ...lead, note: 'x', snapshot: {} })).not.toHaveProperty(
      'snapshot',
    );
  });

  it(`keeps a note up to ${String(LEAD_NOTE_MAX)} characters, line breaks included`, () => {
    const note = (n: number) => UpdateLeadInputSchema.safeParse({ ...lead, note: 'a\n'.repeat(n) });
    expect(note(LEAD_NOTE_MAX / 2).success).toBe(true);
    expect(note(LEAD_NOTE_MAX / 2 + 1).success).toBe(false);
  });

  it('names the lead to delete like the one to create', () => {
    expect(DeleteLeadInputSchema.parse({ workspace_id: WORKSPACE, property_id: '1' })).toEqual({
      workspace_id: WORKSPACE,
      property_id: '1',
      permit_id: '',
    });
  });
});

describe('lead filters', () => {
  const permit = (fields: Partial<LeadPermitSnapshot> = {}): LeadPermitSnapshot => ({
    permit_id: 'FX-1 BP',
    basis: 'longest_open',
    status_group: 'open',
    status: 'Active',
    roof_work_class: 'primary_roof_replacement',
    open_since: '2021-04-01',
    open_duration_days: 5 * 365,
    days_since_expiry: null,
    contractor_name: null,
    bbb_status: null,
    bbb_rating: null,
    ...fields,
  });
  const lead = (fields: Partial<Lead> = {}, snapshot: Partial<Lead['snapshot']> = {}): Lead => ({
    lead_id: '01JBQ80000000000000000000A',
    property_id: '1',
    permit_id: '',
    status: 'new',
    note: '',
    created_at: '2026-10-20T12:00:00.000Z',
    updated_at: '2026-10-20T12:00:00.000Z',
    ...fields,
    snapshot: {
      taken_at: '2026-10-20T12:00:00.000Z',
      run_id: 'fixture-run',
      address: { line1: '1 FIXTURE ST', city: 'TESTVILLE', zip: '00000' },
      lat: 30.25,
      lon: -97.75,
      roof_age_years: 20,
      roof_year: 2006,
      roof_age_basis: 'year_built',
      roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
      permit: permit(),
      ...snapshot,
    },
  });
  const matches = (subject: Lead, filter: LeadFilter) =>
    matchesLeadFilter(subject, LeadFilterSchema.parse(filter));

  it('matches every lead when no field is set', () => {
    expect(isEmptyLeadFilter({})).toBe(true);
    expect(
      matches(lead({}, { roof_age_years: null, permit: null, lat: null, lon: null }), {}),
    ).toBe(true);
    expect(isEmptyLeadFilter({ statuses: [] })).toBe(false);
  });

  it('filters by status; an empty list matches none', () => {
    expect(matches(lead({ status: 'working' }), { statuses: ['new', 'working'] })).toBe(true);
    expect(matches(lead({ status: 'closed' }), { statuses: ['new', 'working'] })).toBe(false);
    expect(matches(lead(), { statuses: [] })).toBe(false);
  });

  it('keeps roofs strictly older than the threshold, as the map does', () => {
    expect(matches(lead(), { roof_age_min: 19 })).toBe(true);
    expect(matches(lead(), { roof_age_min: 20 })).toBe(false);
    expect(matches(lead({}, { roof_age_years: null }), { roof_age_min: 0 })).toBe(false);
  });

  it('filters by the snapshot permit group, `none` for a lead without one', () => {
    expect(leadPermitGroup(lead({}, { permit: null }))).toBe('none');
    expect(matches(lead(), { permit_groups: ['open', 'stalled'] })).toBe(true);
    expect(
      matches(lead({}, { permit: permit({ status_group: 'closed' }) }), {
        permit_groups: ['open'],
      }),
    ).toBe(false);
    expect(matches(lead({}, { permit: null }), { permit_groups: ['none'] })).toBe(true);
    expect(matches(lead({}, { permit: null }), { permit_groups: ['open'] })).toBe(false);
  });

  it('counts open years as the contract does, open or stalled: days >= years x 365', () => {
    expect(matches(lead(), { open_years_min: 5 })).toBe(true);
    expect(
      matches(lead({}, { permit: permit({ open_duration_days: 5 * 365 - 1 }) }), {
        open_years_min: 5,
      }),
    ).toBe(false);
    const stalled = permit({
      status_group: 'stalled',
      open_duration_days: 3000,
      days_since_expiry: 90,
    });
    expect(matches(lead({}, { permit: stalled }), { open_years_min: 8 })).toBe(true);
    expect(
      matches(lead({}, { permit: permit({ open_duration_days: null }) }), { open_years_min: 0 }),
    ).toBe(false);
    expect(matches(lead({}, { permit: null }), { open_years_min: 0 })).toBe(false);
  });

  it('keeps leads within the radius of a point, in great-circle miles', () => {
    // 0.01 degrees of latitude is about 0.69 miles.
    const within = (radius_miles: number) => ({ lat: 30.26, lon: -97.75, radius_miles });
    expect(matches(lead(), { within: within(0.7) })).toBe(true);
    expect(matches(lead(), { within: within(0.6) })).toBe(false);
    expect(matches(lead({}, { lat: null, lon: null }), { within: within(25) })).toBe(false);
  });

  it('needs every field to match', () => {
    const filter = { statuses: ['new' as const], roof_age_min: 15, open_years_min: 5 };
    expect(matches(lead(), filter)).toBe(true);
    expect(matches(lead({ status: 'working' }), filter)).toBe(false);
  });

  it("refuses values outside the map's ranges", () => {
    const bad = [
      { roof_age_min: -1 },
      { roof_age_min: 2.5 },
      { open_years_min: 101 },
      { permit_groups: ['expired'] },
      { within: { lat: 30.25, lon: -97.75, radius_miles: 26 } },
    ];
    for (const filter of bad) expect(LeadFilterSchema.safeParse(filter).success).toBe(false);
    expect(
      ListLeadsInputSchema.parse({ workspace_id: WORKSPACE, filter: { statuses: ['new'] } }).filter,
    ).toEqual({ statuses: ['new'] });
  });
});
