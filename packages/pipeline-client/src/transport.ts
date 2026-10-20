import { PipelineError, parseErrorEnvelope } from './errors';
import { readRequestId } from './request-id';

/** Back-off after a 429, on the status code alone, as the pipeline contract specifies: 1 s, 2 s, 4 s, then fail. */
export const THROTTLE_BACKOFF_MS: readonly number[] = [1000, 2000, 4000];

/** A fast 5xx is retried once, after a full-jitter delay below this bound (metagross item 14). */
export const SERVER_RETRY_MAX_DELAY_MS = 1000;

/**
 * Per-attempt timeouts (metagross item 14): the browser waits longer than the Lambda's tool calls.
 * The browser's outlasts the pipeline function's 25 s limit and stays under API Gateway's 30 s cut,
 * so the browser never abandons a request the pipeline is still working on: the pipeline answers,
 * or fails with its request id, first (pipeline decisions §31).
 */
export const BROWSER_TIMEOUT_MS = 29_000;
export const LAMBDA_TIMEOUT_MS = 8_000;

/**
 * Rejections the gateway or Lambda answer at once (a 429, the account-wide throttle's 503, a 429 the
 * browser cannot read for lack of CORS headers) fail within a second or two. A failure that took
 * longer than this, a timeout included, was admitted and ran: retrying it at once only starts a second
 * cold pipeline instance while the first may still be busy (pipeline decisions §31), so it is not
 * retried automatically. The caller offers "try again".
 */
export const FAST_FAILURE_MS = 5_000;

export type RetryReason = 'throttled' | 'server_error' | 'network';

export interface RetryEvent {
  url: string;
  /** The attempt that just failed, starting at 1. */
  attempt: number;
  delayMs: number;
  reason: RetryReason;
  status?: number | undefined;
  requestId?: string | undefined;
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface PipelineFetchOptions {
  /** Per attempt, covering the response headers and the body. */
  timeoutMs: number;
  /** The fetch to wrap; `globalThis.fetch` when omitted. */
  fetch?: (request: Request) => Promise<Response>;
  /** Waits between attempts; replaced in tests. */
  sleep?: Sleep;
  /** Uniform in [0, 1), for the jitter; replaced in tests. */
  random?: () => number;
  /** Milliseconds, for how long a failed attempt took; replaced in tests. */
  now?: () => number;
  /** Called before each retry, e.g. to show "pipeline busy, retrying" or to log. */
  onRetry?: (event: RetryEvent) => void;
}

/** A `fetch`-compatible function: openapi-fetch and plain callers can both use it. */
export type PipelineFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Resolves after `ms`, or rejects with the signal's reason when it aborts first. */
export const sleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

class AttemptTimeout extends Error {
  override readonly name = 'AttemptTimeout';
}

/**
 * Wraps fetch with the pipeline contract's transport rules:
 * - every attempt has a timeout and honours the caller's AbortSignal;
 * - 429 backs off 1 s, 2 s, 4 s on the status code alone (`Retry-After` may be absent and is ignored);
 * - a request that fails fast without a readable response is treated the same way, because in a browser
 *   a gateway 429 without CORS headers is indistinguishable from a network failure (pipeline decisions
 *   §21);
 * - a fast 5xx (503 included: the account-wide Lambda throttle) is retried once with full jitter, for
 *   idempotent methods only;
 * - a timeout, or any failure slower than FAST_FAILURE_MS, is not retried;
 * - other 4xx (400, 404, 413) are never retried;
 * - the response body is read inside the timeout, so a stalled body cannot hang the caller;
 * - every failure is a `PipelineError` carrying `x-request-id`, else `apigw-requestid`, else the body's `request_id`.
 */
export function createPipelineFetch(options: PipelineFetchOptions): PipelineFetch {
  const baseFetch = options.fetch ?? ((request: Request) => globalThis.fetch(request));
  const wait = options.sleep ?? sleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  return async function pipelineFetch(input, init) {
    const template = new Request(input, init);
    const url = template.url;
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const idempotent = IDEMPOTENT_METHODS.has(template.method.toUpperCase());

    let attempts = 0;
    let throttleRetries = 0;
    let serverRetries = 0;

    const retry = async (
      reason: RetryReason,
      delayMs: number,
      status?: number,
      requestId?: string,
    ): Promise<void> => {
      options.onRetry?.({ url, attempt: attempts, delayMs, reason, status, requestId });
      try {
        await wait(delayMs, callerSignal ?? undefined);
      } catch (cause) {
        throw new PipelineError({ kind: 'aborted', url, attempts, cause });
      }
    };
    const jitter = (): number => Math.floor(random() * SERVER_RETRY_MAX_DELAY_MS);

    for (;;) {
      if (callerSignal?.aborted) {
        throw new PipelineError({ kind: 'aborted', url, attempts, cause: callerSignal.reason });
      }
      attempts += 1;

      const attemptController = new AbortController();
      const timer = setTimeout(() => {
        attemptController.abort(
          new AttemptTimeout(`no response within ${String(options.timeoutMs)} ms`),
        );
      }, options.timeoutMs);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, attemptController.signal])
        : attemptController.signal;

      let response: Response;
      let bodyText: string | undefined;
      const attemptStarted = now();
      try {
        const raw = await baseFetch(new Request(template.clone(), { signal }));
        if (raw.ok) {
          const buffer = NULL_BODY_STATUSES.has(raw.status) ? null : await raw.arrayBuffer();
          clearTimeout(timer);
          return new Response(buffer, {
            status: raw.status,
            statusText: raw.statusText,
            headers: raw.headers,
          });
        }
        response = raw;
        bodyText = await raw.text();
      } catch (cause) {
        clearTimeout(timer);
        if (callerSignal?.aborted) {
          throw new PipelineError({ kind: 'aborted', url, attempts, cause: callerSignal.reason });
        }
        if (attemptController.signal.aborted) {
          throw new PipelineError({ kind: 'timeout', url, attempts, cause });
        }
        if (now() - attemptStarted > FAST_FAILURE_MS) {
          throw new PipelineError({ kind: 'network', url, attempts, cause });
        }
        const backoff = THROTTLE_BACKOFF_MS[throttleRetries];
        if (idempotent && backoff !== undefined) {
          throttleRetries += 1;
          await retry('network', backoff);
          continue;
        }
        throw new PipelineError({ kind: 'network', url, attempts, cause });
      }
      clearTimeout(timer);

      const envelope = parseErrorEnvelope(bodyText);
      const status = response.status;
      const requestId = readRequestId(response.headers) ?? envelope.requestId;

      if (status === 429) {
        const backoff = THROTTLE_BACKOFF_MS[throttleRetries];
        if (backoff !== undefined) {
          throttleRetries += 1;
          await retry('throttled', backoff, status, requestId);
          continue;
        }
        throw new PipelineError({
          ...envelope,
          kind: 'throttled',
          url,
          attempts,
          status,
          requestId,
        });
      }
      const fast = now() - attemptStarted <= FAST_FAILURE_MS;
      if (status >= 500 && fast && idempotent && serverRetries < 1) {
        serverRetries += 1;
        await retry('server_error', jitter(), status, requestId);
        continue;
      }
      throw new PipelineError({ ...envelope, kind: 'http', url, attempts, status, requestId });
    }
  };
}
