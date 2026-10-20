import { describe, expect, it } from 'vitest';
import { fixtureProperty } from '../test/fixtures';
import {
  formatAddress,
  formatCoordinateBasis,
  formatRoofAge,
  formatRoofAnchor,
  formatRoofBasis,
  safeHttpUrl,
} from './format-property';

describe('format-property', () => {
  it('prints the address as the roll has it and says when there is none', () => {
    expect(formatAddress({ line1: '1 FIXTURE ST', city: 'TESTVILLE', zip: '00000' })).toBe(
      '1 FIXTURE ST, TESTVILLE 00000',
    );
    expect(formatAddress({ line1: '1 FIXTURE ST', city: null, zip: null })).toBe('1 FIXTURE ST');
    expect(formatAddress({ line1: null, city: 'TESTVILLE', zip: null })).toBe(
      'No situs address on the roll, TESTVILLE',
    );
  });

  it('states the roof age, or that it is unknown', () => {
    expect(formatRoofAge(fixtureProperty(1))).toBe('Roof 36 years old');
    expect(formatRoofAge(fixtureProperty(1, { roof_age_years: 1 }))).toBe('Roof 1 year old');
    expect(formatRoofAge(fixtureProperty(1, { roof_age_years: null }))).toBe('Roof age unknown');
  });

  it('names the basis and the year it counts from', () => {
    expect(formatRoofBasis(fixtureProperty(1))).toBe(
      'since 1990, year built on the appraisal roll',
    );
    expect(
      formatRoofBasis(
        fixtureProperty(1, { roof_age_basis: 'completed_replacement', roof_year: 2008 }),
      ),
    ).toBe('since 2008, completed roof replacement');
    expect(formatRoofBasis(fixtureProperty(1, { roof_age_basis: null }))).toBeNull();
  });

  it('names the anchor: a permit and its date, or the roll', () => {
    expect(
      formatRoofAnchor({ permit_id: 'FX-1 BP', date: '2008-05-01', date_field: 'completed_date' }),
    ).toBe('permit FX-1 BP, completed date 2008-05-01');
    expect(formatRoofAnchor({ source_field: 'year_built' })).toBe(
      'the year built printed on the appraisal roll',
    );
    expect(formatRoofAnchor(null)).toBeNull();
  });

  it('names the coordinate basis', () => {
    expect(formatCoordinateBasis('parcel_centroid')).toBe('parcel centroid');
    expect(formatCoordinateBasis('permit')).toBe("a permit's location");
    expect(formatCoordinateBasis(null)).toBeNull();
  });

  it('links only http(s) sources', () => {
    expect(safeHttpUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
});
