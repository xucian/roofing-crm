import { fixtureMeta, fixturePermitDetail } from '@roofing-crm/pipeline-client/testing';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handleRequest, withoutPrefix } from './handler';
import {
  MemoryRepository,
  OTHER_WORKSPACE,
  WORKSPACE,
  httpEvent,
  stubPipelineFetch,
} from './test/helpers';

const config = { leadsTable: 'Leads', pipelineApiBase: 'https://pipeline.example.org' };
const lambda = { getRemainingTimeInMillis: () => 29_000 };

function call(event: APIGatewayProxyEventV2, repository = new MemoryRepository()) {
  const pipeline = stubPipelineFetch({
    '/v1/meta': () => ({ body: fixtureMeta() }),
    '/v1/permits/FX-1 BP': () => ({ body: fixturePermitDetail(1), requestId: 'pl-permit' }),
  });
  return handleRequest(event, lambda, { config, repository, fetch: pipeline.fetch }).then(
    (result) => ({
      result,
      body: JSON.parse(result.body ?? 'null') as Record<string, unknown>,
      calls: pipeline.calls,
    }),
  );
}

const create = (body: unknown) =>
  httpEvent({ method: 'POST', path: '/api/trpc/leads.create', body });

describe('the leads function', () => {
  it('saves a lead from its own POST route and answers with the request id', async () => {
    const { result, body } = await call(
      create({ workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: 'FX-1 BP' }),
    );
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      'x-request-id': 'crm-req-1',
      'cache-control': 'no-store',
    });
    expect(body).toMatchObject({
      result: { data: { outcome: 'created', lead: { property_id: 'fx-1', permit_id: 'FX-1 BP' } } },
    });
  });

  it('lists the leads of the workspace through the GET catch-all, and only those', async () => {
    const repository = new MemoryRepository();
    await call(
      create({ workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: 'FX-1 BP' }),
      repository,
    );
    const list = (workspace: string) =>
      call(
        httpEvent({
          method: 'GET',
          path: '/api/trpc/leads.list',
          query: `input=${encodeURIComponent(JSON.stringify({ workspace_id: workspace }))}`,
        }),
        repository,
      );
    const mine = await list(WORKSPACE);
    expect(mine.result.statusCode).toBe(200);
    expect(mine.body).toMatchObject({
      result: { data: { items: [{ permit_id: 'FX-1 BP' }], next_cursor: null } },
    });
    expect((await list(OTHER_WORKSPACE)).body).toMatchObject({
      result: { data: { items: [], next_cursor: null } },
    });
  });

  it("puts the CRM request id and the pipeline's on a failed save", async () => {
    const { result, body } = await call(
      create({ workspace_id: WORKSPACE, property_id: 'fx-404', permit_id: '' }),
    );
    expect(result.statusCode).toBe(404);
    expect(body).toMatchObject({
      error: {
        message: 'Not found in the pipeline API (HTTP 404: not_found).',
        data: {
          code: 'NOT_FOUND',
          requestId: 'crm-req-1',
          failure: { code: 'not_found', pipeline_request_id: 'pl-404' },
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('refuses invalid input before calling the pipeline', async () => {
    const { result, body, calls } = await call(
      create({ workspace_id: 'not-a-ulid', property_id: 'fx-1' }),
    );
    expect(result.statusCode).toBe(400);
    expect(body).toMatchObject({
      error: { data: { code: 'BAD_REQUEST', requestId: 'crm-req-1' } },
    });
    expect(calls).toEqual([]);
  });

  it('refuses a batch, which would slip past the per-route throttles', async () => {
    const { result } = await call(
      httpEvent({
        method: 'GET',
        path: '/api/trpc/leads.list,leads.list',
        query: 'batch=1&input=%7B%7D',
      }),
    );
    expect(result.statusCode).toBe(400);
  });

  it('strips the base path only from CRM API paths', () => {
    const event = httpEvent({ method: 'POST', path: '/api/trpc/leads.create', body: {} });
    expect(withoutPrefix(event).rawPath).toBe('/leads.create');
    expect(withoutPrefix({ ...event, rawPath: '/other' }).rawPath).toBe('/other');
  });
});
