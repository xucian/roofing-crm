import { PipelineError } from '@roofing-crm/pipeline-client';
import { fixtureMeta } from '@roofing-crm/pipeline-client/testing';
import { describe, expect, it } from 'vitest';
import { RequestMetrics } from './observability';
import { DeadlineExceeded, createServerPipeline, failureStatus } from './pipeline';
import { fakeDeadline, stubPipelineFetch } from './test/helpers';

const quiet = { info: () => undefined, warn: () => undefined };

function client(remainingMs: number, routes: Parameters<typeof stubPipelineFetch>[0]) {
  const metrics = new RequestMetrics();
  const deadline = fakeDeadline(remainingMs);
  const stub = stubPipelineFetch(routes);
  const seenSignals: AbortSignal[] = [];
  const pipeline = createServerPipeline({
    baseUrl: 'https://pipeline.example.org',
    deadline,
    metrics,
    logger: quiet,
    fetch: (request) => {
      seenSignals.push(request.signal);
      return stub.fetch(request);
    },
    sleep: () => Promise.resolve(),
  });
  return { pipeline, metrics, deadline, calls: stub.calls, seenSignals };
}

describe('the function’s pipeline client', () => {
  it('counts answered calls', async () => {
    const { pipeline, metrics } = client(25_000, { '/v1/meta': () => ({ body: fixtureMeta() }) });
    await pipeline.getMeta();
    expect(metrics.snapshot()).toEqual({ PipelineCallProcessed: [1] });
  });

  it('starts no call with less than a second left after the reserve', async () => {
    const { pipeline, calls, metrics } = client(2_400, {
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    await expect(pipeline.getMeta()).rejects.toBeInstanceOf(DeadlineExceeded);
    // Nothing was sent, so the pipeline's metrics are untouched; the row reports `deadline`.
    expect(calls).toEqual([]);
    expect(metrics.snapshot()).toEqual({});
  });

  it('labels failures by status for the outage alarm', async () => {
    const { pipeline, metrics } = client(25_000, {
      '/v1/meta': () => ({ status: 503, body: { message: 'Service Unavailable' } }),
    });
    await expect(pipeline.getMeta()).rejects.toBeInstanceOf(PipelineError);
    expect(metrics.snapshot()).toEqual({ 'PipelineCallFailed status=5xx': [1] });
  });

  it('maps each transport failure to one status', () => {
    const error = (init: Partial<ConstructorParameters<typeof PipelineError>[0]>) =>
      new PipelineError({ kind: 'http', url: 'u', attempts: 1, ...init });
    expect(failureStatus(error({ kind: 'throttled', status: 429 }))).toBe('429');
    expect(failureStatus(error({ status: 404 }))).toBe('4xx');
    expect(failureStatus(error({ status: 502 }))).toBe('5xx');
    expect(failureStatus(error({ kind: 'timeout' }))).toBe('timeout');
    expect(failureStatus(error({ kind: 'network' }))).toBe('network');
    expect(failureStatus(new DeadlineExceeded('u'))).toBe('aborted');
  });
});
