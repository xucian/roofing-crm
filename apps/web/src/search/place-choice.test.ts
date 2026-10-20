import { describe, expect, it } from 'vitest';
import { fixtureCenter } from '../test/fixtures';
import { choosePlace, describePlace } from './place-choice';

describe('choosePlace', () => {
  it('goes to the one exact match', () => {
    const exact = fixtureCenter();
    expect(
      choosePlace([exact, fixtureCenter({ name: 'FIXTUREVILLE EAST', match_type: 'prefix' })]),
    ).toEqual({
      kind: 'go',
      center: exact,
    });
  });

  it('asks when no match is exact', () => {
    const centers = [
      fixtureCenter({ match_type: 'prefix' }),
      fixtureCenter({ name: 'FX', match_type: 'alias' }),
    ];
    expect(choosePlace(centers)).toEqual({ kind: 'ask', centers });
  });

  it('asks when an alias is the only match', () => {
    expect(choosePlace([fixtureCenter({ match_type: 'alias' })]).kind).toBe('ask');
  });

  it('asks when two places match exactly', () => {
    const centers = [fixtureCenter(), fixtureCenter({ kind: 'zip', name: '00000' })];
    expect(choosePlace(centers).kind).toBe('ask');
  });

  it('says when nothing matches', () => {
    expect(choosePlace([])).toEqual({ kind: 'none' });
  });
});

describe('describePlace', () => {
  it('shows the kind, the match type and the parcel count', () => {
    expect(describePlace(fixtureCenter())).toBe(
      'FIXTUREVILLE · city · exact match · 1,234 parcels',
    );
    expect(
      describePlace(
        fixtureCenter({ kind: 'zip', name: '00000', match_type: 'prefix', parcel_count: 1 }),
      ),
    ).toBe('00000 · ZIP · starts with your text · 1 parcel');
  });
});
