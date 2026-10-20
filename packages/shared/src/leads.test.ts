import { describe, expect, it } from 'vitest';
import {
  CREATE_MANY_MAX,
  CreateLeadInputSchema,
  CreateManyLeadsInputSchema,
  LeadSnapshotSchema,
  ListLeadsInputSchema,
  leadKey,
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
