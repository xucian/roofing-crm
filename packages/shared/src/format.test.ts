import { describe, expect, it } from 'vitest';
import { formatCoordinates, formatCount, formatMatchSummary, formatMiles } from './format';
import { DISABLED_SECTIONS } from './sections';

describe('formatMatchSummary', () => {
  it('states the total and how many rows are on screen', () => {
    expect(formatMatchSummary(12431, 500)).toBe('12,431 matches, showing 500');
  });

  it('omits "showing" when every match is on screen', () => {
    expect(formatMatchSummary(42, 42)).toBe('42 matches');
    expect(formatMatchSummary(1, 1)).toBe('1 match');
  });

  it('says so when nothing matches', () => {
    expect(formatMatchSummary(0, 0)).toBe('No matches');
  });
});

describe('number and coordinate formats', () => {
  it('groups thousands', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('prints miles with at most one decimal', () => {
    expect(formatMiles(5)).toBe('5 mi');
    expect(formatMiles(0.25)).toBe('0.3 mi');
    expect(formatMiles(12.34)).toBe('12.3 mi');
  });

  it('prints coordinates at fixed precision with an ASCII minus', () => {
    expect(formatCoordinates({ lat: 30.2672, lon: -97.7431 })).toBe('30.26720, -97.74310');
  });
});

describe('DISABLED_SECTIONS', () => {
  it('lists the five future sections of docs/decisions.md §7 in order', () => {
    expect(DISABLED_SECTIONS.map((section) => section.label)).toEqual([
      'Outreach',
      'Campaigns',
      'Sequences',
      'Reporting',
      'Billing',
    ]);
  });
});
