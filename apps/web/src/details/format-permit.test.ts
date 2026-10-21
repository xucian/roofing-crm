import { describe, expect, it } from 'vitest';
import { fixturePermit } from '../test/fixtures';
import {
  comparePermits,
  contractorLines,
  formatBbb,
  formatOpenDuration,
  formatPropertyLink,
  groupPermits,
  permitDates,
} from './format-permit';

describe('permit order', () => {
  it('sorts as the permit search does: status, then longest open, then id', () => {
    const permits = [
      fixturePermit(1, { status_group: 'closed', open_duration_days: null }),
      fixturePermit(2, { status_group: 'stalled', open_duration_days: 4000 }),
      fixturePermit(3, { status_group: 'open', open_duration_days: 100 }),
      fixturePermit(4, { status_group: 'needs_review', open_duration_days: null }),
      fixturePermit(5, { status_group: 'open', open_duration_days: 9000 }),
      fixturePermit(6, { status_group: 'open', open_duration_days: null }),
      fixturePermit(7, { status_group: 'open', open_duration_days: 100 }),
    ];
    expect([...permits].sort(comparePermits).map((permit) => permit.permit_id)).toEqual([
      'FX-5 BP',
      'FX-3 BP',
      'FX-7 BP',
      'FX-6 BP',
      'FX-2 BP',
      'FX-1 BP',
      'FX-4 BP',
    ]);
  });

  it('puts roofing permits apart from the property’s other permits', () => {
    const { roofing, other } = groupPermits([
      fixturePermit(1, { is_roofing: false, roof_work_class: 'other' }),
      fixturePermit(2),
    ]);
    expect(roofing.map((permit) => permit.permit_id)).toEqual(['FX-2 BP']);
    expect(other.map((permit) => permit.permit_id)).toEqual(['FX-1 BP']);
  });
});

describe('open duration', () => {
  it('says how long an open permit has been open, and since when', () => {
    expect(formatOpenDuration(fixturePermit(1))).toBe('Open 5.4 years, since 2021-04-01 (issued)');
  });

  it('says how long a stalled permit was open and how long ago it expired', () => {
    expect(
      formatOpenDuration(
        fixturePermit(1, {
          status: 'Expired',
          status_group: 'stalled',
          open_duration_days: 180,
          open_duration_basis: 'expires_date',
          expires_date: '2023-05-28',
          days_since_expiry: 1241,
        }),
      ),
    ).toBe(
      'Was open 5 months, since 2021-04-01 (issued) until it expired on 2023-05-28, 3.3 years ago',
    );
  });

  it('has nothing to say for closed permits', () => {
    expect(
      formatOpenDuration(fixturePermit(1, { status_group: 'closed', open_duration_days: null })),
    ).toBeNull();
  });

  it('says a permit listed as open or stalled was completed, never how long it is open', () => {
    expect(
      formatOpenDuration(
        fixturePermit(1, { open_duration_days: 10151, completed_date: '1999-07-04' }),
      ),
    ).toBe('Listed as open, but completed 1999-07-04');
    expect(
      formatOpenDuration(
        fixturePermit(1, {
          status: 'Expired',
          status_group: 'stalled',
          open_duration_days: 900,
          completed_date: '2020-01-02',
        }),
      ),
    ).toBe('Listed as stalled, but completed 2020-01-02');
  });
});

describe('permit fields', () => {
  it('lists only the dates the permit has', () => {
    expect(permitDates(fixturePermit(1))).toEqual([
      { label: 'Applied', value: '2021-01-01' },
      { label: 'Issued', value: '2021-04-01' },
      { label: 'Expires', value: '2022-04-01' },
    ]);
  });

  it('shows BBB exactly as the API reports it', () => {
    expect(
      formatBbb({ rating: 'A+', status: 'available', incomplete_reason: null, note: null }),
    ).toBe('Rating A+');
    expect(
      formatBbb({ rating: null, status: 'unavailable', incomplete_reason: null, note: null }),
    ).toBe('No BBB profile');
    expect(formatBbb(fixturePermit(1).bbb)).toBe('Blocked at source');
  });

  it('lists the contractor’s printed fields that are present', () => {
    const contractor = fixturePermit(1).contractor;
    expect(contractor).not.toBeNull();
    expect(contractorLines({ ...contractor!, company_name: null, phone: ' ' })).toEqual([
      { label: 'Name', value: 'FIXTURE ROOFER' },
      { label: 'Trade', value: 'General Contractor' },
    ]);
  });

  it('shows a printed phone only when it has at least 10 digits, never an area code alone', () => {
    const contractor = fixturePermit(1).contractor!;
    const phone = (printed: string) =>
      contractorLines({ ...contractor, phone: printed }).find((line) => line.label === 'Phone');
    expect(phone('512')).toBeUndefined();
    expect(phone('(000) 000-000')).toBeUndefined();
    expect(phone('(000) 000-0000')).toEqual({ label: 'Phone', value: '(000) 000-0000' });
    expect(phone('+1 000 000 0000')).toEqual({ label: 'Phone', value: '+1 000 000 0000' });
  });

  it('says how the permit was linked to the property', () => {
    expect(formatPropertyLink(fixturePermit(1).property_link)).toBe(
      'Linked because the permit’s TCAD id equals the property’s geo id.',
    );
  });
});
