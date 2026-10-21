import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH } from '../search/search-state';
import { fixtureProperty } from '../test/fixtures';
import {
  INITIAL_RESULTS,
  queryKey,
  resultsReducer,
  toPropertyQuery,
  viewFor,
  type ResultsState,
} from './property-search';

const page = (items: ReturnType<typeof fixtureProperty>[], total: number, next: string | null) => ({
  data: { items, total, next_cursor: next, area_note: null },
  requestId: 'req-1',
});

function started(key = 'k1', run = 1): ResultsState {
  return resultsReducer(INITIAL_RESULTS, { type: 'start', run, key, at: 1000, restarted: false });
}

describe('toPropertyQuery', () => {
  it('asks for aged roofs or open and stalled roof jobs, 500 at a time (§4)', () => {
    expect(toPropertyQuery(DEFAULT_SEARCH)).toEqual({
      lat: 30.2672,
      lon: -97.7431,
      radius_miles: 5,
      roof_age_min: 15,
      open_permits: true,
      long_open_years: 5,
      roof_work_class: ['primary_roof_replacement', 'repair_or_coating'],
      limit: 500,
    });
  });

  it('asks for aged roofs only when the permit toggle is off', () => {
    const query = toPropertyQuery({ ...DEFAULT_SEARCH, openPermits: false });
    expect(query.open_permits).toBe(false);
    expect(query.roof_work_class).toBeUndefined();
  });

  it('keys equal queries equally', () => {
    expect(queryKey(toPropertyQuery(DEFAULT_SEARCH))).toBe(
      queryKey(toPropertyQuery({ ...DEFAULT_SEARCH, centerSource: 'pin' })),
    );
  });
});

describe('resultsReducer', () => {
  it('keeps the first page as the markers and the total as the API counted it', () => {
    const state = resultsReducer(started(), {
      type: 'answered',
      run: 1,
      answer: page([fixtureProperty(1), fixtureProperty(2)], 1200, 'c2'),
    });
    expect(state.pending).toBeNull();
    expect(state.results).toMatchObject({
      key: 'k1',
      total: 1200,
      nextCursor: 'c2',
      requestId: 'req-1',
    });
    expect(state.results?.mapItems).toHaveLength(2);
  });

  it('ignores the answer of a search that a newer one replaced', () => {
    const newer = resultsReducer(started('k1', 1), {
      type: 'start',
      run: 2,
      key: 'k2',
      at: 2000,
      restarted: false,
    });
    const after = resultsReducer(newer, { type: 'answered', run: 1, answer: page([], 0, null) });
    expect(after).toBe(newer);
  });

  it('appends the next page to the list but not to the markers', () => {
    const first = resultsReducer(started(), {
      type: 'answered',
      run: 1,
      answer: page([fixtureProperty(1)], 2, 'c2'),
    });
    const loading = resultsReducer(first, { type: 'moreStart', run: 1 });
    expect(loading.more).toEqual({ status: 'loading' });
    const more = resultsReducer(loading, {
      type: 'moreAnswered',
      run: 1,
      answer: page([fixtureProperty(2)], 2, null),
    });
    expect(more.results?.items.map((item) => item.property_id)).toEqual(['fx-1', 'fx-2']);
    expect(more.results?.mapItems.map((item) => item.property_id)).toEqual(['fx-1']);
    expect(more.results?.nextCursor).toBeNull();
    expect(more.more).toEqual({ status: 'idle' });
  });

  it('records a failed next page without dropping the rows', () => {
    const first = resultsReducer(started(), {
      type: 'answered',
      run: 1,
      answer: page([fixtureProperty(1)], 2, 'c2'),
    });
    const failed = resultsReducer(first, { type: 'moreFailed', run: 1, error: new Error('x') });
    expect(failed.more.status).toBe('failed');
    expect(failed.results?.items).toHaveLength(1);
  });
});

describe('viewFor', () => {
  it('is loading, with the earlier rows, until the current query answers', () => {
    const answered = resultsReducer(started('k1'), {
      type: 'answered',
      run: 1,
      answer: page([fixtureProperty(1)], 1, null),
    });
    expect(viewFor(answered, 'k1').kind).toBe('ready');
    const view = viewFor(answered, 'k2');
    expect(view).toMatchObject({ kind: 'loading', startedAt: null });
    expect(view.kind === 'loading' && view.previous?.key).toBe('k1');
  });

  it('shows the failure of the current query', () => {
    const failed = resultsReducer(started('k1'), { type: 'failed', run: 1, error: 'boom' });
    expect(viewFor(failed, 'k1')).toEqual({ kind: 'failed', error: 'boom' });
    expect(viewFor(failed, 'k2').kind).toBe('loading');
  });

  it('counts the wait from the start of the current query', () => {
    expect(viewFor(started('k1'), 'k1')).toEqual({
      kind: 'loading',
      startedAt: 1000,
      previous: null,
    });
  });
});
