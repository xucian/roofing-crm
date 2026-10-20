import type { Logger } from '@aws-lambda-powertools/logger';
import type { Tracer } from '@aws-lambda-powertools/tracer';
import {
  PipelineError,
  SERVER_TIMEOUT_MAX_MS,
  createPipelineClient,
  createPipelineFetch,
  readRequestId,
  type PipelineClient,
  type PipelineFetch,
  type Sleep,
} from '@roofing-crm/pipeline-client';
import { DEADLINE_RESERVE_MS, MIN_CALL_MS, type Deadline } from './deadline';
import { METRIC, type PipelineFailureStatus } from './metric-names';
import type { RequestMetrics } from './observability';

/** The request's time ran out before a pipeline call could start; nothing was sent. */
export class DeadlineExceeded extends Error {
  override readonly name = 'DeadlineExceeded';
  constructor(readonly url: string) {
    super('The request ran out of time before calling the pipeline.');
  }
}

export interface ServerPipelineOptions {
  baseUrl: string;
  deadline: Deadline;
  metrics: RequestMetrics;
  logger: Pick<Logger, 'info' | 'warn'>;
  tracer?: Pick<Tracer, 'isTracingEnabled' | 'getSegment' | 'setSegment'> | undefined;
  /** Replaced in tests. */
  fetch?: (request: Request) => Promise<Response>;
  sleep?: Sleep;
  now?: () => number;
}

/** The `status` dimension of a failed call. */
export function failureStatus(error: unknown): PipelineFailureStatus {
  if (!(error instanceof PipelineError)) return 'aborted';
  switch (error.kind) {
    case 'throttled':
      return '429';
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    case 'http':
      return (error.status ?? 0) >= 500 ? '5xx' : '4xx';
  }
}

/**
 * The `leads` function's pipeline client: the contract's transport (429 back-off, one fast-5xx retry,
 * request ids) with each attempt's timeout taken from what is left of the request's deadline, up to
 * 20 s (docs/decisions.md, 2026-10-20 cold starts). Back-offs end when the deadline does. Every call
 * is logged with its pipeline request id, counted in PipelineCallProcessed or PipelineCallFailed, and
 * traced as its own subsegment. Callers make one call at a time (the account runs 10 Lambda
 * executions in all), so nothing here queues.
 */
export function createServerPipeline(options: ServerPipelineOptions): PipelineClient {
  const now = options.now ?? Date.now;
  const { deadline, metrics, logger, tracer } = options;
  const attemptTimeout = (): number =>
    Math.max(1, Math.min(SERVER_TIMEOUT_MAX_MS, deadline.remainingMs() - DEADLINE_RESERVE_MS));

  const transport = createPipelineFetch({
    timeoutMs: attemptTimeout,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    now,
    onRetry: (event) => {
      logger.warn('pipeline call retried', {
        path: new URL(event.url).pathname,
        attempt: event.attempt,
        reason: event.reason,
        status: event.status,
        delay_ms: event.delayMs,
        pipeline_request_id: event.requestId,
      });
    },
  });

  const observed: PipelineFetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (deadline.remainingMs() - DEADLINE_RESERVE_MS < MIN_CALL_MS) {
      throw new DeadlineExceeded(request.url);
    }
    const parent = tracer?.isTracingEnabled() ? tracer.getSegment() : undefined;
    const subsegment = parent?.addNewSubsegment(`pipeline ${path}`);
    if (subsegment) tracer?.setSegment(subsegment);
    const started = now();
    try {
      const response = await transport(request, { signal: deadline.signal });
      const requestId = readRequestId(response.headers);
      metrics.count(METRIC.pipelineCallProcessed, {});
      logger.info('pipeline call', {
        path,
        status: response.status,
        duration_ms: now() - started,
        pipeline_request_id: requestId,
      });
      subsegment?.addAnnotation('pipeline_request_id', requestId ?? '');
      return response;
    } catch (error) {
      const status = failureStatus(error);
      metrics.count(METRIC.pipelineCallFailed, { status });
      logger.warn('pipeline call failed', {
        path,
        status,
        http_status: error instanceof PipelineError ? error.status : undefined,
        duration_ms: now() - started,
        pipeline_request_id: error instanceof PipelineError ? error.requestId : undefined,
      });
      if (error instanceof Error) subsegment?.addError(error);
      throw error;
    } finally {
      subsegment?.close();
      if (parent) tracer?.setSegment(parent);
    }
  };

  return createPipelineClient({ baseUrl: options.baseUrl, fetch: observed });
}
