import { fixturePermit, fixtureProperty } from '@roofing-crm/pipeline-client/testing';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, clip, permitSnapshot, printedContractor } from './snapshot';

const contractor = fixturePermit(1).contractor!;

describe('lead snapshot', () => {
  it('names the contractor as printed, else the company, else nobody', () => {
    expect(printedContractor(fixturePermit(1))).toBe('FIXTURE ROOFER');
    expect(
      printedContractor(fixturePermit(1, { contractor: { ...contractor, printed_name: ' ' } })),
    ).toBe('FIXTURE ROOFING CO');
    expect(
      printedContractor(
        fixturePermit(1, { contractor: { ...contractor, printed_name: '', company_name: null } }),
      ),
    ).toBeNull();
    expect(printedContractor(fixturePermit(1, { contractor: null }))).toBeNull();
  });

  it('keeps BBB only where a contractor is printed', () => {
    expect(permitSnapshot(fixturePermit(1), 'saved')).toMatchObject({ bbb_status: 'blocked' });
    expect(permitSnapshot(fixturePermit(1, { contractor: null }), 'saved')).toMatchObject({
      contractor_name: null,
      bbb_status: null,
      bbb_rating: null,
    });
  });

  it('cuts third-party text to the bounds instead of refusing the lead', () => {
    expect(clip('x'.repeat(300), 200)).toHaveLength(200);
    const long = fixturePermit(1, { status: 's'.repeat(500) });
    expect(permitSnapshot(long, 'saved').status).toHaveLength(120);
    const snapshot = buildSnapshot({
      property: fixtureProperty(1, {
        address: { line1: 'a'.repeat(300), city: null, zip: null },
      }),
      permit: null,
      runId: 'fixture-run',
      takenAt: new Date('2026-10-20T12:00:00Z'),
    });
    expect(snapshot.address.line1).toHaveLength(200);
  });
});
