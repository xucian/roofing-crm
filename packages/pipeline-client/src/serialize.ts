import { PipelineError } from './errors';
import type { PipelineFetch } from './transport';

/**
 * At most one call of `inner` in flight; the others wait in order. The pipeline's AWS account runs
 * 10 Lambda executions at once, shared by every client of its API and chat, so a CRM page never
 * fans out (pipeline handoff, 2026-10-20). A call holds its place through its retries and back-offs.
 * A waiting call whose signal aborts leaves the queue at once, without holding up the calls behind it.
 */
export function serializeFetch(inner: PipelineFetch): PipelineFetch {
  let tail: Promise<void> = Promise.resolve();

  return async function serializedFetch(input, init) {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const previous = tail;
    let release = (): void => undefined;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    tail = previous.then(() => finished);
    try {
      await waitTurn(previous, signal ?? undefined, urlOf(input));
      return await inner(input, init);
    } finally {
      release();
    }
  };
}

function waitTurn(previous: Promise<void>, signal: AbortSignal | undefined, url: string) {
  const aborted = (): PipelineError =>
    new PipelineError({ kind: 'aborted', url, attempts: 0, cause: signal?.reason });
  if (signal?.aborted) return Promise.reject(aborted());
  if (!signal) return previous;
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      reject(aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void previous.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
