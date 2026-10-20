import {
  isStaleCursor,
  type PermitSearchQuery,
  type PermitSearchResponse,
  type PermitSummary,
  type PipelineAnswer,
  type PipelineClient,
  type PropertyDetail,
} from '@roofing-crm/pipeline-client';
import { useEffect, useReducer, useRef, useState } from 'react';

/** Every permit of the property, roofing or not, in any status: the drawer's full list. */
const ALL_STATUS_GROUPS: NonNullable<PermitSearchQuery['status_group']> = [
  'open',
  'stalled',
  'closed',
  'needs_review',
];
/** The permit search's largest page. */
export const PERMIT_PAGE_LIMIT = 500;

export interface PermitPages {
  status: 'idle' | 'loading' | 'failed';
  error: unknown;
  /** Permits read through `/v1/permits/search`; null while the embedded first 50 are shown. */
  searched: { items: PermitSummary[]; nextCursor: string | null } | null;
}

export type DetailState =
  | { status: 'closed' }
  | { status: 'loading'; propertyId: string; startedAt: number }
  | { status: 'failed'; propertyId: string; error: unknown }
  | {
      status: 'ready';
      propertyId: string;
      detail: PropertyDetail;
      requestId: string | undefined;
      pages: PermitPages;
    };

export type DetailAction =
  | { type: 'close' }
  | { type: 'start'; propertyId: string; at: number }
  | { type: 'answered'; propertyId: string; answer: PipelineAnswer<PropertyDetail> }
  | { type: 'failed'; propertyId: string; error: unknown }
  | { type: 'pagesStart'; propertyId: string }
  | {
      type: 'pagesAnswered';
      propertyId: string;
      answer: PipelineAnswer<PermitSearchResponse>;
      append: boolean;
    }
  | { type: 'pagesFailed'; propertyId: string; error: unknown };

const NO_PAGES: PermitPages = { status: 'idle', error: null, searched: null };

export function detailReducer(state: DetailState, action: DetailAction): DetailState {
  switch (action.type) {
    case 'close':
      return { status: 'closed' };
    case 'start':
      return { status: 'loading', propertyId: action.propertyId, startedAt: action.at };
    default:
      break;
  }
  // An answer for a property no longer open is dropped.
  if (state.status === 'closed' || state.propertyId !== action.propertyId) return state;
  switch (action.type) {
    case 'answered':
      return {
        status: 'ready',
        propertyId: action.propertyId,
        detail: action.answer.data,
        requestId: action.answer.requestId,
        pages: NO_PAGES,
      };
    case 'failed':
      return { status: 'failed', propertyId: action.propertyId, error: action.error };
    case 'pagesStart':
      return state.status === 'ready'
        ? { ...state, pages: { ...state.pages, status: 'loading', error: null } }
        : state;
    case 'pagesAnswered': {
      if (state.status !== 'ready') return state;
      const { items, next_cursor } = action.answer.data;
      const before = action.append ? (state.pages.searched?.items ?? []) : [];
      return {
        ...state,
        pages: {
          status: 'idle',
          error: null,
          searched: { items: [...before, ...items], nextCursor: next_cursor },
        },
      };
    }
    case 'pagesFailed':
      return state.status === 'ready'
        ? { ...state, pages: { ...state.pages, status: 'failed', error: action.error } }
        : state;
  }
}

/** The permits to list: every page read so far, or the embedded first 50. */
export function listedPermits(detail: PropertyDetail, pages: PermitPages): PermitSummary[] {
  return pages.searched?.items ?? detail.permits;
}

/** Whether the property has permits the list does not show yet. */
export function hasMorePermits(detail: PropertyDetail, pages: PermitPages): boolean {
  if (pages.searched === null) return detail.permits_truncated;
  return pages.searched.nextCursor !== null;
}

export interface PropertyDetailLoader {
  state: DetailState;
  /** Reads the property again after a failure. */
  retry: () => void;
  /** Reads the next page of the property's permits through `/v1/permits/search?property_id=`. */
  loadMorePermits: () => void;
}

/**
 * The open property: `GET /v1/properties/{id}` when the drawer opens or switches, then, on request,
 * the permits beyond the embedded first 50 (docs/decisions.md 2026-10-17). Each read goes through
 * the page's one-at-a-time queue, and opening another property cancels the read in flight.
 */
export function usePropertyDetail(
  client: PipelineClient | null,
  propertyId: string | null,
): PropertyDetailLoader {
  const [state, dispatch] = useReducer(detailReducer, { status: 'closed' });
  const [reruns, setReruns] = useState(0);
  const pagesController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!client || propertyId === null) {
      dispatch({ type: 'close' });
      return undefined;
    }
    const controller = new AbortController();
    dispatch({ type: 'start', propertyId, at: Date.now() });
    client.getProperty(propertyId, { signal: controller.signal }).then(
      (answer) => {
        dispatch({ type: 'answered', propertyId, answer });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', propertyId, error });
      },
    );
    return () => {
      controller.abort();
      pagesController.current?.abort();
    };
  }, [client, propertyId, reruns]);

  const readPermits = (id: string, cursor: string | null): void => {
    if (!client) return;
    const controller = new AbortController();
    pagesController.current?.abort();
    pagesController.current = controller;
    dispatch({ type: 'pagesStart', propertyId: id });
    const query: PermitSearchQuery = {
      property_id: id,
      status_group: ALL_STATUS_GROUPS,
      roofing_only: false,
      limit: PERMIT_PAGE_LIMIT,
      ...(cursor === null ? {} : { cursor }),
    };
    client.searchPermits(query, { signal: controller.signal }).then(
      (answer) => {
        dispatch({ type: 'pagesAnswered', propertyId: id, answer, append: cursor !== null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // The pipeline redeployed or the day changed under the cursor: start the list over.
        if (cursor !== null && isStaleCursor(error)) {
          readPermits(id, null);
          return;
        }
        dispatch({ type: 'pagesFailed', propertyId: id, error });
      },
    );
  };

  const loadMorePermits = (): void => {
    if (state.status !== 'ready' || state.pages.status === 'loading') return;
    if (!hasMorePermits(state.detail, state.pages)) return;
    readPermits(state.propertyId, state.pages.searched?.nextCursor ?? null);
  };

  const retry = (): void => {
    setReruns((count) => count + 1);
  };

  return { state, retry, loadMorePermits };
}
