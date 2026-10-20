import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createPipelineClient, type PipelineSchemas } from './client';
import { PipelineError, isStaleCursor } from './errors';
import { createPipelineFetch, type PipelineFetch } from './transport';

// A local server records each request and answers with transport fixtures: empty result sets and
// error envelopes in the contract's shapes, never county data (docs/decisions.md §8).

interface Seen {
  path: string;
  query: URLSearchParams;
  accept: string | undefined;
}

let server: Server;
let base: string;
let seen: Seen[] = [];
let answer: { status: number; body: unknown; headers?: Record<string, string> } = {
  status: 200,
  body: {},
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    seen.push({ path: url.pathname, query: url.searchParams, accept: request.headers.accept });
    response.writeHead(answer.status, {
      'content-type': 'application/json',
      'x-request-id': 'req-fixture-1',
      ...answer.headers,
    });
    response.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  seen = [];
  answer = { status: 200, body: {} };
});

function client(fetch?: PipelineFetch) {
  return createPipelineClient({
    baseUrl: base,
    fetch:
      fetch ??
      createPipelineFetch({ timeoutMs: 2000, sleep: () => Promise.resolve(), random: () => 0 }),
  });
}

const EMPTY_SEARCH = { items: [], total: 0, next_cursor: null, area_note: null };

describe('createPipelineClient', () => {
  it('sends the map search as the contract names it and returns the request id', async () => {
    answer = { status: 200, body: EMPTY_SEARCH };
    const result = await client().searchProperties({
      lat: 30.2672,
      lon: -97.7431,
      radius_miles: 5,
      roof_age_min: 15,
      open_permits: false,
      limit: 500,
    });
    expect(result).toEqual({ data: EMPTY_SEARCH, requestId: 'req-fixture-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe('/v1/properties/search');
    expect(Object.fromEntries(seen[0]?.query ?? [])).toEqual({
      lat: '30.2672',
      lon: '-97.7431',
      radius_miles: '5',
      roof_age_min: '15',
      open_permits: 'false',
      limit: '500',
    });
    expect(seen[0]?.accept).toBe('application/json');
  });

  it('passes the cursor of the next page through unchanged', async () => {
    answer = { status: 200, body: EMPTY_SEARCH };
    await client().searchProperties({ lat: 30.3, lon: -97.7, limit: 500, cursor: 'abc+/=' });
    expect(seen[0]?.query.get('cursor')).toBe('abc+/=');
  });

  it('encodes the place box query', async () => {
    answer = { status: 200, body: { items: [] } };
    const result = await client().searchCenters('West Lake & Hills');
    expect(result.data).toEqual({ items: [] });
    expect(seen[0]?.path).toBe('/v1/search-centers');
    expect(seen[0]?.query.get('q')).toBe('West Lake & Hills');
  });

  it('reads one property, with the id encoded as one path segment', async () => {
    answer = { status: 200, body: { property_id: 'fx 1/2' } };
    const result = await client().getProperty('fx 1/2');
    expect(seen[0]?.path).toBe('/v1/properties/fx%201%2F2');
    expect(result).toEqual({ data: { property_id: 'fx 1/2' }, requestId: 'req-fixture-1' });
  });

  it('reads one permit, with the space in its number encoded', async () => {
    answer = { status: 200, body: { permit_id: 'FX-1 BP' } };
    const result = await client().getPermit('FX-1 BP');
    expect(seen[0]?.path).toBe('/v1/permits/FX-1%20BP');
    expect(result).toEqual({ data: { permit_id: 'FX-1 BP' }, requestId: 'req-fixture-1' });
  });

  it('sends list parameters of the permit search comma-separated, as the contract says', async () => {
    answer = { status: 200, body: EMPTY_SEARCH };
    await client().searchPermits({
      property_id: 'fx-1',
      status_group: ['open', 'stalled', 'closed', 'needs_review'],
      roofing_only: false,
      limit: 500,
    });
    expect(seen[0]?.path).toBe('/v1/permits/search');
    expect(seen[0]?.query.getAll('status_group')).toEqual(['open,stalled,closed,needs_review']);
    expect(Object.fromEntries(seen[0]?.query ?? [])).toEqual({
      property_id: 'fx-1',
      status_group: 'open,stalled,closed,needs_review',
      roofing_only: 'false',
      limit: '500',
    });
  });

  it('reads /v1/meta', async () => {
    answer = { status: 200, body: { county: 'fixture' } };
    const result = await client().getMeta();
    expect(seen[0]?.path).toBe('/v1/meta');
    expect(result.requestId).toBe('req-fixture-1');
  });

  it('throws the transport error with the contract fields, e.g. a stale cursor', async () => {
    answer = {
      status: 400,
      body: { error: 'stale_cursor', request_id: 'req-fixture-2' },
      headers: { 'x-request-id': 'req-fixture-2' },
    };
    const error: unknown = await client()
      .searchProperties({ lat: 30.3, lon: -97.7, cursor: 'old' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PipelineError);
    expect(isStaleCursor(error)).toBe(true);
    expect((error as PipelineError).requestId).toBe('req-fixture-2');
  });

  it('hands its signal to the transport', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const recording: PipelineFetch = (input, init) => {
      signals.push(init?.signal ?? (input instanceof Request ? input.signal : undefined));
      return Promise.resolve(Response.json(EMPTY_SEARCH));
    };
    const controller = new AbortController();
    await client(recording).searchProperties({ limit: 1 }, { signal: controller.signal });
    controller.abort();
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('the pinned error schemas', () => {
  // The transport reads `error` and `request_id` from every error body (errors.ts). If the pinned
  // contract stops carrying them, this stops compiling.
  it('carry error and request_id', () => {
    expectTypeOf<PipelineSchemas['Error400']>().toHaveProperty('error').toEqualTypeOf<string>();
    expectTypeOf<PipelineSchemas['Error400']>()
      .toHaveProperty('request_id')
      .toEqualTypeOf<string>();
    expectTypeOf<PipelineSchemas['Error404']>().toHaveProperty('request_id');
    expectTypeOf<PipelineSchemas['Error5xx']>().toHaveProperty('error');
    expectTypeOf<PipelineSchemas['Error5xx']>().toHaveProperty('request_id');
    expectTypeOf<PipelineSchemas['GatewayError']>()
      .toHaveProperty('message')
      .toEqualTypeOf<string>();
  });
});
