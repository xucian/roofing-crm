import { describe, expect, it } from 'vitest';
import {
  ROOF_JOB_CLASSES,
  callablePhone,
  hasCompletionConflict,
  isLongOpenLead,
  isRoofJobLead,
} from './permits';

// The permit fields the rules read, as the pipeline serves them; synthetic values only.
const permit = (overrides: Partial<Parameters<typeof isLongOpenLead>[0]> = {}) => ({
  status_group: 'open',
  roof_work_class: 'primary_roof_replacement',
  open_duration_days: 2000,
  completed_date: null as string | null,
  ...overrides,
});

describe('roof jobs', () => {
  it('are a roof replacement, or a repair or coating', () => {
    expect(ROOF_JOB_CLASSES).toEqual(['primary_roof_replacement', 'repair_or_coating']);
  });
});

describe('a lead permit', () => {
  it('is an open or stalled roof job with no completed date', () => {
    expect(isRoofJobLead(permit())).toBe(true);
    expect(isRoofJobLead(permit({ roof_work_class: 'repair_or_coating' }))).toBe(true);
    expect(isRoofJobLead(permit({ status_group: 'stalled', open_duration_days: 30 }))).toBe(true);
    for (const roof_work_class of [
      'accessory_roof',
      'primary_roof_new_construction',
      'other',
      'needs_review',
    ]) {
      expect(isRoofJobLead(permit({ roof_work_class }))).toBe(false);
    }
    expect(isRoofJobLead(permit({ completed_date: '1999-07-04' }))).toBe(false);
    expect(isRoofJobLead(permit({ status_group: 'closed' }))).toBe(false);
    expect(isRoofJobLead(permit({ status_group: 'needs_review' }))).toBe(false);
  });
});

describe('a long-open lead', () => {
  it('is a lead permit open or stalled for five years or more', () => {
    expect(isLongOpenLead(permit({ open_duration_days: 1825 }))).toBe(true);
    expect(isLongOpenLead(permit({ open_duration_days: 1824 }))).toBe(false);
    expect(isLongOpenLead(permit({ status_group: 'stalled', open_duration_days: 4000 }))).toBe(
      true,
    );
    expect(isLongOpenLead(permit({ open_duration_days: null }))).toBe(false);
    expect(isLongOpenLead(permit({ status_group: 'closed', open_duration_days: 9000 }))).toBe(
      false,
    );
  });

  it('is never an accessory roof or a permit with a completed date, however long it was open', () => {
    // The shape of 1999-002931 BP: a storage shed printed "Active", completed 1999-07-04.
    const shed = permit({
      roof_work_class: 'accessory_roof',
      open_duration_days: 10151,
      completed_date: '1999-07-04',
    });
    expect(isLongOpenLead(shed)).toBe(false);
    expect(isLongOpenLead({ ...shed, roof_work_class: 'primary_roof_replacement' })).toBe(false);
    expect(isLongOpenLead({ ...shed, completed_date: null })).toBe(false);
    expect(isLongOpenLead(permit({ roof_work_class: 'primary_roof_new_construction' }))).toBe(
      false,
    );
  });
});

describe('a completion conflict', () => {
  it('is a permit listed as open or stalled that carries a completed date', () => {
    expect(hasCompletionConflict(permit({ completed_date: '1999-07-04' }))).toBe(true);
    expect(
      hasCompletionConflict(permit({ status_group: 'stalled', completed_date: '2020-01-02' })),
    ).toBe(true);
    expect(hasCompletionConflict(permit())).toBe(false);
    expect(
      hasCompletionConflict(permit({ status_group: 'closed', completed_date: '2020-01-02' })),
    ).toBe(false);
  });
});

describe('a callable phone', () => {
  it('has at least 10 digits; an area code alone, or a short number, is not one', () => {
    expect(callablePhone('512')).toBeNull();
    expect(callablePhone('(000) 000-000')).toBeNull();
    expect(callablePhone(' ')).toBeNull();
    expect(callablePhone(null)).toBeNull();
    expect(callablePhone('(000) 000-0000')).toBe('(000) 000-0000');
    expect(callablePhone('+1 000 000 0000')).toBe('+1 000 000 0000');
  });
});
