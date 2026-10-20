import { describe, expect, it } from 'vitest';
import { createCrmApiClient, describeCrmApiError } from './index';

const WORKSPACE = '01JBQ7Z0000000000000000000';

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  const seen: Request[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    seen.push(new Request(input, init));
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return Promise.resolve(
      new Response(text, { status, headers: { 'content-type': 'application/json', ...headers } }),
    );
  };
  return { fetch, seen };
}

describe('createCrmApiClient', () => {
  it('sends one procedure per request to its own path, a mutation as POST', async () => {
    const { fetch, seen } = stub(200, { result: { data: { outcome: 'created' } } });
    const client = createCrmApiClient({ url: 'https://crm.example.org/api/trpc', fetch });
    await client.leads.create.mutate({ workspace_id: WORKSPACE, property_id: 'fx-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
    expect(new URL(seen[0]!.url).pathname).toBe('/api/trpc/leads.create');
    expect(new URL(seen[0]!.url).search).toBe('');
  });

  it('reads the list with GET and the input in the query', async () => {
    const { fetch, seen } = stub(200, { result: { data: { items: [], next_cursor: null } } });
    const client = createCrmApiClient({ url: 'https://crm.example.org/api/trpc', fetch });
    await client.leads.list.query({ workspace_id: WORKSPACE });
    const url = new URL(seen[0]!.url);
    expect(seen[0]?.method).toBe('GET');
    expect(url.pathname).toBe('/api/trpc/leads.list');
    expect(JSON.parse(url.searchParams.get('input') ?? '')).toEqual({ workspace_id: WORKSPACE });
  });
});

describe('describeCrmApiError', () => {
  it('carries the CRM and pipeline request ids of a failed save', async () => {
    const { fetch } = stub(404, {
      error: {
        message: 'Not found in the pipeline API (HTTP 404: not_found).',
        code: -32004,
        data: {
          code: 'NOT_FOUND',
          httpStatus: 404,
          path: 'leads.create',
          requestId: 'crm-1',
          failure: { code: 'not_found', message: 'x', pipeline_request_id: 'pl-1' },
        },
      },
    });
    const client = createCrmApiClient({ url: 'https://crm.example.org/api/trpc', fetch });
    const error = await client.leads.create
      .mutate({ workspace_id: WORKSPACE, property_id: 'fx-404' })
      .catch((caught: unknown) => caught);
    expect(describeCrmApiError(error)).toEqual({
      message: 'Not found in the pipeline API (HTTP 404: not_found).',
      status: 404,
      requestId: 'crm-1',
      failure: { code: 'not_found', message: 'x', pipeline_request_id: 'pl-1' },
    });
  });

  it('says what answered when the function did not: a gateway throttle', async () => {
    const { fetch } = stub(429, { message: 'Too Many Requests' }, { 'apigw-requestid': 'gw-1' });
    const client = createCrmApiClient({ url: 'https://crm.example.org/api/trpc', fetch });
    const error = await client.leads.create
      .mutate({ workspace_id: WORKSPACE, property_id: 'fx-1' })
      .catch((caught: unknown) => caught);
    expect(describeCrmApiError(error)).toMatchObject({
      message: 'The CRM API is busy (HTTP 429). Wait a moment and try again.',
      status: 429,
      requestId: 'gw-1',
    });
  });
});
