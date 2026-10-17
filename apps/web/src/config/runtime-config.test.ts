import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig, parseRuntimeConfig } from './runtime-config';

const respond =
  (status: number, body: string): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    );

describe('parseRuntimeConfig', () => {
  it('normalizes the pipeline API base', () => {
    expect(
      parseRuntimeConfig({
        pipelineApiBase: 'https://abc123.execute-api.us-east-2.amazonaws.com/',
      }),
    ).toEqual({ pipelineApiBase: 'https://abc123.execute-api.us-east-2.amazonaws.com' });
  });

  it('accepts a deployment without a pipeline API', () => {
    expect(parseRuntimeConfig({ pipelineApiBase: null })).toEqual({ pipelineApiBase: null });
  });

  it('rejects a missing field and an insecure URL', () => {
    expect(() => parseRuntimeConfig({})).toThrow(/config\.json is invalid/);
    expect(() => parseRuntimeConfig({ pipelineApiBase: 'http://api.example.com' })).toThrow(
      /https/,
    );
  });
});

describe('loadRuntimeConfig', () => {
  it('fetches /config.json', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      calls.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
      return respond(200, '{"pipelineApiBase":null}')(input);
    };
    await expect(loadRuntimeConfig(fetchImpl)).resolves.toEqual({ pipelineApiBase: null });
    expect(calls).toEqual(['/config.json']);
  });

  it('reports a missing or broken file', async () => {
    await expect(loadRuntimeConfig(respond(404, 'Not Found'))).rejects.toThrow(/HTTP 404/);
    await expect(loadRuntimeConfig(respond(200, '<html>'))).rejects.toThrow(/not JSON/);
  });
});
