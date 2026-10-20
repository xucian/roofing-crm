import { useEffect, useReducer, type Dispatch } from 'react';
import { replaceUrlParams } from '../app/url-params';
import {
  parseSearchParams,
  searchReducer,
  toSearchParams,
  type SearchAction,
  type SearchState,
} from './search-state';

/** Search state that starts from the URL and keeps the URL in step, without adding history entries. */
export function useSearchState(): [SearchState, Dispatch<SearchAction>] {
  const [state, dispatch] = useReducer(searchReducer, undefined, () =>
    parseSearchParams(new URLSearchParams(window.location.search)),
  );

  useEffect(() => {
    replaceUrlParams(toSearchParams(state));
  }, [state]);

  return [state, dispatch];
}
