import {
  BROWSER_TIMEOUT_MS,
  createPipelineClient,
  createPipelineFetch,
  serializeFetch,
  type PipelineClient,
  type PipelineFetch,
  type RetryEvent,
} from '@roofing-crm/pipeline-client';
import { useSyncExternalStore } from 'react';

/** The back-off the call in flight is waiting out, for "pipeline busy, retrying"; null otherwise. */
export interface RetryFeed {
  subscribe: (listener: () => void) => () => void;
  current: () => RetryEvent | null;
}

export interface PipelineConnection {
  client: PipelineClient;
  retries: RetryFeed;
}

/**
 * The page's one way to the pipeline API: the contract's transport with the browser timeout, behind
 * a queue that keeps one call in flight (the pipeline's account runs 10 Lambda executions in all).
 * Since calls never overlap, one retry feed describes whichever call is running.
 */
export function createPipelineConnection(baseUrl: string): PipelineConnection {
  let latest: RetryEvent | null = null;
  const listeners = new Set<() => void>();
  const publish = (event: RetryEvent | null): void => {
    if (event === latest) return;
    latest = event;
    for (const listener of listeners) listener();
  };

  // A retry is announced for its back-off only; once the next attempt is under way, the panel's
  // loading state speaks for it.
  const onRetry = (event: RetryEvent): void => {
    publish(event);
    window.setTimeout(() => {
      if (latest === event) publish(null);
    }, event.delayMs);
  };
  const transport = createPipelineFetch({ timeoutMs: BROWSER_TIMEOUT_MS, onRetry });
  const tracked: PipelineFetch = async (input, init) => {
    try {
      return await transport(input, init);
    } finally {
      publish(null);
    }
  };

  return {
    client: createPipelineClient({ baseUrl, fetch: serializeFetch(tracked) }),
    retries: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      current: () => latest,
    },
  };
}

const NO_FEED: RetryFeed = { subscribe: () => () => undefined, current: () => null };

export function useRetryEvent(feed: RetryFeed | null): RetryEvent | null {
  const source = feed ?? NO_FEED;
  return useSyncExternalStore(source.subscribe, source.current);
}

/** One sentence for the retry notice. */
export function describeRetry(event: RetryEvent): string {
  const wait = `Retrying in ${formatSeconds(event.delayMs)}…`;
  switch (event.reason) {
    case 'throttled':
      return `The pipeline API is busy (HTTP 429). ${wait}`;
    case 'server_error':
      return `The pipeline API answered HTTP ${String(event.status ?? '5xx')}. ${wait}`;
    case 'network':
      return `The pipeline API could not be reached. ${wait}`;
  }
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${seconds < 1 ? seconds.toFixed(1) : String(Math.round(seconds))} s`;
}
