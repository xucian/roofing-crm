import {
  isStaleCursor,
  type PipelineClient,
  type PropertySearchQuery,
  type PropertySearchResponse,
} from '@roofing-crm/pipeline-client';
import { useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import type { SearchState } from '../search/search-state';
import {
  INITIAL_RESULTS,
  queryKey,
  resultsReducer,
  toPropertyQuery,
  viewFor,
  type ResultsState,
  type ResultsView,
} from './property-search';

/** A change of radius, threshold or center waits this long for the next one before searching. */
export const SEARCH_DEBOUNCE_MS = 400;

export interface PropertySearch {
  view: ResultsView;
  state: ResultsState;
  /** Fetches the next page into the list through `next_cursor`. */
  loadMore: () => void;
}

/**
 * Runs the map's search against the pipeline: on load at once, then after each change settles.
 * A newer search cancels the older one. "Load more" pages through `next_cursor`, and a stale cursor
 * (the pipeline redeployed, or the day changed) restarts the list from its first page.
 */
export function usePropertySearch(
  client: PipelineClient | null,
  search: SearchState,
  onAnswer?: (data: PropertySearchResponse, search: SearchState) => void,
): PropertySearch {
  // Keyed on the query's value: a change that leaves it equal (a reset to the defaults already
  // shown) neither cancels nor repeats the search in flight.
  const key = queryKey(toPropertyQuery(search));
  const query = useMemo(() => JSON.parse(key) as PropertySearchQuery, [key]);
  const [state, dispatch] = useReducer(resultsReducer, INITIAL_RESULTS);
  const [restarts, setRestarts] = useState(0);
  const runs = useRef(0);
  const started = useRef(false);
  const restartPending = useRef(false);
  const moreController = useRef<AbortController | null>(null);
  const answered = useEffectEvent((data: PropertySearchResponse) => {
    onAnswer?.(data, search);
  });

  useEffect(() => {
    if (!client) return undefined;
    const controller = new AbortController();
    const immediate = !started.current || restartPending.current;
    const timer = window.setTimeout(
      () => {
        started.current = true;
        const restarted = restartPending.current;
        restartPending.current = false;
        runs.current += 1;
        const run = runs.current;
        dispatch({ type: 'start', run, key, at: Date.now(), restarted });
        client.searchProperties(query, { signal: controller.signal }).then(
          (answer) => {
            dispatch({ type: 'answered', run, answer });
            answered(answer.data);
          },
          (error: unknown) => {
            if (!controller.signal.aborted) dispatch({ type: 'failed', run, error });
          },
        );
      },
      immediate ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      moreController.current?.abort();
    };
  }, [client, key, query, restarts]);

  const view = viewFor(state, key);

  const loadMore = (): void => {
    if (!client || view.kind !== 'ready' || state.more.status === 'loading') return;
    const cursor = view.results.nextCursor;
    if (cursor === null) return;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    const run = state.run;
    dispatch({ type: 'moreStart', run });
    client.searchProperties({ ...query, cursor }, { signal: controller.signal }).then(
      (answer) => {
        dispatch({ type: 'moreAnswered', run, answer });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStaleCursor(error)) {
          restartPending.current = true;
          setRestarts((count) => count + 1);
          return;
        }
        dispatch({ type: 'moreFailed', run, error });
      },
    );
  };

  return { view, state, loadMore };
}
