import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PipelineError, isStaleCursor } from './errors';
import { readRequestId } from './request-id';
import { createPipelineFetch, sleep, type RetryEvent } from './transport';

// A real HTTP server on an ephemeral port stands in for the pipeline API (metagross item 21: the
// client's 429 back-off, timeout and non-retry behaviour against a local fake server). Bodies are
// transport fixtures, not county data.

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  hit: number,
  body: string,
) => void;

const routes = new Map<string, Handler>();
const hits = new Map<string, number>();
let server: Server;
let base: string;

function reply(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      const handler = routes.get(path);
      if (handler) handler(request, response, hit, body);
      else reply(response, 418, { error: 'no_route' });
    });
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
  routes.clear();
  hits.clear();
});

function harness(timeoutMs = 2000) {
  const delays: number[] = [];
  const retries: RetryEvent[] = [];
  const pipelineFetch = createPipelineFetch({
    timeoutMs,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    onRetry: (event) => retries.push(event),
  });
  return { pipelineFetch, delays, retries };
}

async function failure(promise: Promise<unknown>): Promise<PipelineError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PipelineError) return error;
    throw error;
  }
  throw new Error('expected a PipelineError');
}

describe('success', () => {
  it('returns the body intact with its request id', async () => {
    routes.set('/ok', (_req, res) => {
      reply(res, 200, { ok: true }, { 'x-request-id': 'req-ok' });
    });
    const { pipelineFetch, delays } = harness();
    const response = await pipelineFetch(`${base}/ok`);
    expect(response.status).toBe(200);
    expect(readRequestId(response.headers)).toBe('req-ok');
    expect(await response.json()).toEqual({ ok: true });
    expect(delays).toEqual([]);
  });

  it('accepts a Request object, as openapi-fetch passes one', async () => {
    routes.set('/echo-header', (req, res) => {
      reply(res, 200, { accept: req.headers.accept });
    });
    const { pipelineFetch } = harness();
    const response = await pipelineFetch(
      new Request(`${base}/echo-header`, { headers: { accept: 'application/json' } }),
    );
    expect(await response.json()).toEqual({ accept: 'application/json' });
  });
});

describe('429 back-off on the status code alone', () => {
  it('waits 1 s then 2 s and succeeds on the third attempt', async () => {
    routes.set('/busy-twice', (_req, res, hit) => {
      if (hit <= 2)
        reply(
          res,
          429,
          { message: 'Too Many Requests' },
          { 'apigw-requestid': `gw-${String(hit)}` },
        );
      else reply(res, 200, { ok: true });
    });
    const { pipelineFetch, delays, retries } = harness();
    const response = await pipelineFetch(`${base}/busy-twice`);
    expect(response.status).toBe(200);
    expect(delays).toEqual([1000, 2000]);
    expect(retries.map((event) => [event.reason, event.requestId])).toEqual([
      ['throttled', 'gw-1'],
      ['throttled', 'gw-2'],
    ]);
  });

  it('gives up after 1 s, 2 s, 4 s with the gateway request id', async () => {
    routes.set('/busy', (_req, res) => {
      reply(
        res,
        429,
        { message: 'Too Many Requests' },
        { 'apigw-requestid': 'gw-busy', 'retry-after': '30' },
      );
    });
    const { pipelineFetch, delays } = harness();
    const error = await failure(pipelineFetch(`${base}/busy`));
    expect(error.kind).toBe('throttled');
    expect(error.attempts).toBe(4);
    expect(error.status).toBe(429);
    expect(error.requestId).toBe('gw-busy');
    expect(error.detail).toBe('Too Many Requests');
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(hits.get('/busy')).toBe(4);
  });
});

describe('5xx and timeouts retry once', () => {
  it('retries a 500 once after a jittered delay', async () => {
    routes.set('/flaky', (_req, res, hit) => {
      if (hit === 1)
        reply(
          res,
          500,
          { error: 'internal', request_id: 'req-500' },
          { 'x-request-id': 'req-500' },
        );
      else reply(res, 200, { ok: true });
    });
    const { pipelineFetch, delays, retries } = harness();
    const response = await pipelineFetch(`${base}/flaky`);
    expect(response.status).toBe(200);
    expect(delays).toEqual([500]);
    expect(retries[0]).toMatchObject({ reason: 'server_error', status: 500, requestId: 'req-500' });
  });

  it('fails after the second 502', async () => {
    routes.set('/down', (_req, res) => {
      reply(res, 502, { message: 'Internal Server Error' }, { 'apigw-requestid': 'gw-502' });
    });
    const { pipelineFetch } = harness();
    const error = await failure(pipelineFetch(`${base}/down`));
    expect(error).toMatchObject({ kind: 'http', status: 502, attempts: 2, requestId: 'gw-502' });
  });

  it('times out a silent server, retries once, then fails as a timeout', async () => {
    routes.set('/silent', () => {
      // never answers
    });
    const { pipelineFetch, retries } = harness(50);
    const error = await failure(pipelineFetch(`${base}/silent`));
    expect(error.kind).toBe('timeout');
    expect(error.attempts).toBe(2);
    expect(retries.map((event) => event.reason)).toEqual(['timeout']);
  });

  it('counts a stalled body against the timeout', async () => {
    routes.set('/stall-body', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"items": [');
    });
    const { pipelineFetch } = harness(50);
    const error = await failure(pipelineFetch(`${base}/stall-body`));
    expect(error.kind).toBe('timeout');
  });

  it('recovers when the retry answers in time', async () => {
    routes.set('/slow-once', (_req, res, hit) => {
      if (hit === 1) {
        setTimeout(() => {
          reply(res, 200, { late: true });
        }, 300);
      } else reply(res, 200, { ok: true });
    });
    const { pipelineFetch } = harness(50);
    const response = await pipelineFetch(`${base}/slow-once`);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('never retried', () => {
  it('returns a 404 at once with the contract error fields', async () => {
    routes.set('/v1/properties/missing', (_req, res) => {
      reply(res, 404, { error: 'not_found', request_id: 'req-404' }, { 'x-request-id': 'req-404' });
    });
    const { pipelineFetch, delays } = harness();
    const error = await failure(pipelineFetch(`${base}/v1/properties/missing`));
    expect(error).toMatchObject({
      kind: 'http',
      status: 404,
      code: 'not_found',
      requestId: 'req-404',
      attempts: 1,
    });
    expect(delays).toEqual([]);
  });

  it('flags a stale cursor and reads the request id from the body when the header is absent', async () => {
    routes.set('/stale', (_req, res) => {
      reply(res, 400, {
        error: 'stale_cursor',
        detail: 'cursor from another snapshot',
        request_id: 'req-400',
      });
    });
    const { pipelineFetch } = harness();
    const error = await failure(pipelineFetch(`${base}/stale`));
    expect(isStaleCursor(error)).toBe(true);
    expect(error.requestId).toBe('req-400');
    expect(error.detail).toBe('cursor from another snapshot');
  });

  it('does not retry a POST on a 500 but does on a 429, resending the body', async () => {
    const bodies: string[] = [];
    routes.set('/post-500', (_req, res) => {
      reply(res, 500, { error: 'internal' });
    });
    routes.set('/post-429', (_req, res, hit, body) => {
      bodies.push(body);
      if (hit === 1) reply(res, 429, { message: 'Too Many Requests' });
      else reply(res, 200, { ok: true });
    });
    const { pipelineFetch } = harness();
    const error = await failure(
      pipelineFetch(`${base}/post-500`, { method: 'POST', body: '{"a":1}' }),
    );
    expect(error.attempts).toBe(1);
    const response = await pipelineFetch(`${base}/post-429`, { method: 'POST', body: '{"a":1}' });
    expect(response.status).toBe(200);
    expect(bodies).toEqual(['{"a":1}', '{"a":1}']);
  });
});

describe('network failures and cancellation', () => {
  it('backs off like a throttle when no response is readable, then fails as network', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    const { pipelineFetch, delays } = harness();
    const error = await failure(pipelineFetch(`http://127.0.0.1:${String(port)}/v1/meta`));
    expect(error.kind).toBe('network');
    expect(error.attempts).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('retries a slow failure without a readable response once, like a 5xx', async () => {
    let clock = 0;
    const delays: number[] = [];
    const pipelineFetch = createPipelineFetch({
      timeoutMs: 29_000,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
      // Each reading is 6 s after the last: every attempt fails after more than FAST_FAILURE_MS.
      now: () => (clock += 6000),
    });
    const error = await failure(pipelineFetch(`${base}/v1/properties/search`));
    expect(error.kind).toBe('network');
    expect(error.attempts).toBe(2);
    expect(delays).toEqual([500]);
  });

  it('does not send anything when the caller already aborted', async () => {
    routes.set('/never', (_req, res) => {
      reply(res, 200, {});
    });
    const { pipelineFetch } = harness();
    const controller = new AbortController();
    controller.abort();
    const error = await failure(pipelineFetch(`${base}/never`, { signal: controller.signal }));
    expect(error.kind).toBe('aborted');
    expect(hits.get('/never')).toBeUndefined();
  });

  it('stops waiting when the caller aborts during a back-off', async () => {
    routes.set('/busy-abort', (_req, res) => {
      reply(res, 429, { message: 'Too Many Requests' });
    });
    const pipelineFetch = createPipelineFetch({ timeoutMs: 2000, sleep });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 20);
    const started = Date.now();
    const error = await failure(pipelineFetch(`${base}/busy-abort`, { signal: controller.signal }));
    expect(error.kind).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(900);
  });
});
