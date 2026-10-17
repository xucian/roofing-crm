import { describe, expect, it } from 'vitest';
import { PipelineError, describePipelineError, isStaleCursor, parseErrorEnvelope } from './errors';

describe('parseErrorEnvelope', () => {
  it('reads the contract error body', () => {
    expect(
      parseErrorEnvelope('{"error":"invalid_params","detail":"radius_miles","request_id":"r1"}'),
    ).toEqual({
      body: { error: 'invalid_params', detail: 'radius_miles', request_id: 'r1' },
      code: 'invalid_params',
      detail: 'radius_miles',
      requestId: 'r1',
    });
  });

  it("falls back to API Gateway's message", () => {
    expect(parseErrorEnvelope('{"message":"Too Many Requests"}').detail).toBe('Too Many Requests');
  });

  it('ignores fields of the wrong type and non-object bodies', () => {
    expect(parseErrorEnvelope('{"error":42}').code).toBeUndefined();
    expect(parseErrorEnvelope('[1,2]')).toEqual({ body: [1, 2] });
    expect(parseErrorEnvelope('<html>bad gateway</html>')).toEqual({
      body: '<html>bad gateway</html>',
    });
  });
});

describe('describePipelineError', () => {
  const error = (init: Partial<ConstructorParameters<typeof PipelineError>[0]>) =>
    new PipelineError({
      kind: 'http',
      url: 'https://example.invalid/v1/meta',
      attempts: 1,
      ...init,
    });

  it('names the status and code', () => {
    expect(describePipelineError(error({ status: 404, code: 'not_found' }))).toBe(
      'Not found in the pipeline API (HTTP 404: not_found).',
    );
    expect(describePipelineError(error({ status: 503 }))).toBe(
      'The pipeline API failed (HTTP 503).',
    );
    expect(describePipelineError(error({ status: 400, code: 'stale_cursor' }))).toBe(
      'The pipeline API rejected the request (HTTP 400: stale_cursor).',
    );
  });

  it('counts the throttle retries', () => {
    expect(describePipelineError(error({ kind: 'throttled', status: 429, attempts: 4 }))).toBe(
      'The pipeline API is busy (HTTP 429) and stayed busy after 3 retries.',
    );
  });

  it('keeps the message equal to the description', () => {
    const timeout = error({ kind: 'timeout' });
    expect(timeout.message).toBe(describePipelineError(timeout));
    expect(timeout.name).toBe('PipelineError');
  });
});

describe('isStaleCursor', () => {
  it('matches only a 400 stale_cursor PipelineError', () => {
    const stale = new PipelineError({
      kind: 'http',
      url: 'u',
      attempts: 1,
      status: 400,
      code: 'stale_cursor',
    });
    const other = new PipelineError({
      kind: 'http',
      url: 'u',
      attempts: 1,
      status: 400,
      code: 'invalid_params',
    });
    expect(isStaleCursor(stale)).toBe(true);
    expect(isStaleCursor(other)).toBe(false);
    expect(isStaleCursor(new Error('stale_cursor'))).toBe(false);
  });
});
