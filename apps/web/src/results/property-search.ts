import type {
  PipelineAnswer,
  PropertySearchQuery,
  PropertySearchResponse,
  PropertySummary,
} from '@roofing-crm/pipeline-client';
import { MAP_RESULT_LIMIT } from '@roofing-crm/shared';
import type { SearchState } from '../search/search-state';

/**
 * The map's search as the pipeline names it. F1 asks for aged roofs only (`open_permits=false`);
 * F2 adds the open-permit toggle (docs/decisions.md 2026-10-17). The first 500 rows are the markers.
 */
export function toPropertyQuery(search: SearchState): PropertySearchQuery {
  return {
    lat: search.center.lat,
    lon: search.center.lon,
    radius_miles: search.radiusMiles,
    roof_age_min: search.roofAgeMin,
    open_permits: false,
    limit: MAP_RESULT_LIMIT,
  };
}

/** Identifies a query, so an answer is shown only for the search it answers. */
export function queryKey(query: PropertySearchQuery): string {
  return JSON.stringify(query);
}

export interface SearchResults {
  key: string;
  /** Every row loaded so far: the first page, then each "load more". */
  items: PropertySummary[];
  /** The first page, drawn as markers (docs/decisions.md §4 "Scale"). */
  mapItems: PropertySummary[];
  total: number;
  nextCursor: string | null;
  areaNote: string | null;
  /** `x-request-id` of the first page, shown under the results. */
  requestId: string | undefined;
}

export type MoreState =
  { status: 'idle' } | { status: 'loading' } | { status: 'failed'; error: unknown };

export interface ResultsState {
  /** The latest search started; answers from earlier ones are ignored. */
  run: number;
  pending: { key: string; startedAt: number } | null;
  /** The latest answered search, possibly for an earlier query than the one on screen. */
  results: SearchResults | null;
  failure: { key: string; error: unknown } | null;
  more: MoreState;
  /** The list restarted from its first page after a stale cursor. */
  restarted: boolean;
}

export type ResultsAction =
  | { type: 'start'; run: number; key: string; at: number; restarted: boolean }
  | { type: 'answered'; run: number; answer: PipelineAnswer<PropertySearchResponse> }
  | { type: 'failed'; run: number; error: unknown }
  | { type: 'moreStart'; run: number }
  | { type: 'moreAnswered'; run: number; answer: PipelineAnswer<PropertySearchResponse> }
  | { type: 'moreFailed'; run: number; error: unknown };

export const INITIAL_RESULTS: ResultsState = {
  run: 0,
  pending: null,
  results: null,
  failure: null,
  more: { status: 'idle' },
  restarted: false,
};

export function resultsReducer(state: ResultsState, action: ResultsAction): ResultsState {
  if (action.type === 'start') {
    return {
      ...state,
      run: action.run,
      pending: { key: action.key, startedAt: action.at },
      failure: null,
      more: { status: 'idle' },
      restarted: action.restarted,
    };
  }
  if (action.run !== state.run) return state;
  switch (action.type) {
    case 'answered': {
      const key = state.pending?.key;
      if (key === undefined) return state;
      const { items, total, next_cursor, area_note } = action.answer.data;
      return {
        ...state,
        pending: null,
        results: {
          key,
          items,
          mapItems: items,
          total,
          nextCursor: next_cursor,
          areaNote: area_note,
          requestId: action.answer.requestId,
        },
      };
    }
    case 'failed': {
      const key = state.pending?.key;
      if (key === undefined) return state;
      return { ...state, pending: null, failure: { key, error: action.error } };
    }
    case 'moreStart':
      return { ...state, more: { status: 'loading' } };
    case 'moreAnswered': {
      if (!state.results) return state;
      const { items, total, next_cursor } = action.answer.data;
      return {
        ...state,
        more: { status: 'idle' },
        results: {
          ...state.results,
          items: [...state.results.items, ...items],
          total,
          nextCursor: next_cursor,
        },
      };
    }
    case 'moreFailed':
      return { ...state, more: { status: 'failed', error: action.error } };
  }
}

/** What the panel shows for the query on screen. */
export type ResultsView =
  | { kind: 'loading'; startedAt: number | null; previous: SearchResults | null }
  | { kind: 'failed'; error: unknown }
  | { kind: 'ready'; results: SearchResults };

export function viewFor(state: ResultsState, key: string): ResultsView {
  if (state.failure?.key === key && state.pending === null) {
    return { kind: 'failed', error: state.failure.error };
  }
  if (state.results?.key === key && state.pending === null) {
    return { kind: 'ready', results: state.results };
  }
  return {
    kind: 'loading',
    startedAt: state.pending?.key === key ? state.pending.startedAt : null,
    previous: state.results,
  };
}
