import { describe, expect, it } from 'vitest';
import { fixturePermit } from './testing/fixtures';
import { comparePermits, longestOpenRoofingPermit } from './order';

describe('permit order', () => {
  it('lists open, stalled, closed, then needs review; longest open first; then by id', () => {
    const permits = [
      fixturePermit(1, { status_group: 'closed', open_duration_days: null }),
      fixturePermit(2, { status_group: 'stalled', open_duration_days: 400 }),
      fixturePermit(3, { status_group: 'open', open_duration_days: 100 }),
      fixturePermit(4, { status_group: 'open', open_duration_days: 3000 }),
      fixturePermit(5, { status_group: 'needs_review', open_duration_days: null }),
      fixturePermit(6, { status_group: 'open', open_duration_days: null }),
    ];
    expect([...permits].sort(comparePermits).map((permit) => permit.permit_id)).toEqual([
      'FX-4 BP',
      'FX-3 BP',
      'FX-6 BP',
      'FX-2 BP',
      'FX-1 BP',
      'FX-5 BP',
    ]);
  });

  it("finds a property's lead permit among its roofing permits only", () => {
    const permits = [
      fixturePermit(1, { status_group: 'stalled', open_duration_days: 5000 }),
      fixturePermit(2, { is_roofing: false, status_group: 'open', open_duration_days: 9000 }),
      fixturePermit(3, { status_group: 'open', open_duration_days: 10 }),
    ];
    expect(longestOpenRoofingPermit(permits)?.permit_id).toBe('FX-3 BP');
    expect(longestOpenRoofingPermit([fixturePermit(4, { status_group: 'closed' })])).toBeNull();
  });
});
