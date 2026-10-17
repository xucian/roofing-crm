/**
 * How a pipeline call failed:
 * - `http`: a final non-2xx response that is not a throttle (400, 404, 413, 5xx after its retry);
 * - `throttled`: 429 after the 1 s, 2 s, 4 s back-off;
 * - `timeout`: no complete response within the per-attempt timeout, after its retry;
 * - `network`: the request never produced a readable response;
 * - `aborted`: the caller cancelled it.
 */
export type PipelineErrorKind = 'http' | 'throttled' | 'timeout' | 'network' | 'aborted';

export interface PipelineErrorInit {
  kind: PipelineErrorKind;
  url: string;
  attempts: number;
  status?: number | undefined;
  requestId?: string | undefined;
  code?: string | undefined;
  detail?: string | undefined;
  body?: unknown;
  cause?: unknown;
}

/** Every failed pipeline call surfaces as one of these, carrying the request id when one exists. */
export class PipelineError extends Error {
  override readonly name = 'PipelineError';
  readonly kind: PipelineErrorKind;
  readonly url: string;
  readonly attempts: number;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  /** The `error` field of the contract's error body, e.g. `stale_cursor`. */
  readonly code: string | undefined;
  /** The `detail` field of the error body, or API Gateway's `message`. Third-party text: render as plain text. */
  readonly detail: string | undefined;
  readonly body: unknown;

  constructor(init: PipelineErrorInit) {
    super(describe(init), { cause: init.cause });
    this.kind = init.kind;
    this.url = init.url;
    this.attempts = init.attempts;
    this.status = init.status;
    this.requestId = init.requestId;
    this.code = init.code;
    this.detail = init.detail;
    this.body = init.body;
  }
}

export function isPipelineError(error: unknown): error is PipelineError {
  return error instanceof PipelineError;
}

/** `400 {error: "stale_cursor"}`: the list must restart from its first page (contract, "Paging"). */
export function isStaleCursor(error: unknown): boolean {
  return (
    isPipelineError(error) &&
    error.kind === 'http' &&
    error.status === 400 &&
    error.code === 'stale_cursor'
  );
}

export interface ErrorEnvelope {
  code?: string | undefined;
  detail?: string | undefined;
  requestId?: string | undefined;
  body: unknown;
}

const MAX_TEXT_BODY = 500;

/**
 * Reads the error body the contract's Transport section describes (`{error, detail, request_id}`)
 * or API Gateway's own `{message}`, without trusting its shape.
 */
export function parseErrorEnvelope(text: string): ErrorEnvelope {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { body: text.slice(0, MAX_TEXT_BODY) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { body };
  const record = body as Record<string, unknown>;
  const field = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    body,
    code: field('error'),
    detail: field('detail') ?? field('message'),
    requestId: field('request_id'),
  };
}

/** One sentence for an error state; the request id is shown beside it, not inside it. */
export function describePipelineError(error: PipelineError): string {
  return describe(error);
}

function describe(init: PipelineErrorInit): string {
  switch (init.kind) {
    case 'throttled':
      return `The pipeline API is busy (HTTP 429) and stayed busy after ${String(init.attempts - 1)} retries.`;
    case 'timeout':
      return 'The pipeline API did not answer in time.';
    case 'network':
      return 'The pipeline API could not be reached.';
    case 'aborted':
      return 'The request was cancelled.';
    case 'http': {
      const status = init.status ?? 0;
      const code = init.code ? `: ${init.code}` : '';
      if (status === 404) return `Not found in the pipeline API (HTTP 404${code}).`;
      if (status >= 500) return `The pipeline API failed (HTTP ${String(status)}${code}).`;
      return `The pipeline API rejected the request (HTTP ${String(status)}${code}).`;
    }
  }
}
