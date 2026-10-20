import type { PipelineClient } from '@roofing-crm/pipeline-client';
import {
  fixtureDetail,
  fixtureMeta,
  fixturePermit,
  fixturePermitDetail,
} from '@roofing-crm/pipeline-client/testing';
import { LeadSchema } from '@roofing-crm/shared';
import { describe, expect, it } from 'vitest';
import { RequestMetrics } from '../observability';
import { createServerPipeline } from '../pipeline';
import {
  MemoryRepository,
  WORKSPACE,
  fakeDeadline,
  stubPipelineFetch,
  type PipelineRoute,
} from '../test/helpers';
import { LeadRowFailure, createLeadService } from './service';

const BASE = 'https://pipeline.example.org';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const quiet = { info: () => undefined, warn: () => undefined };

function setup(routes: Record<string, PipelineRoute>, remainingMs = 25_000) {
  const repository = new MemoryRepository();
  const metrics = new RequestMetrics();
  const deadline = fakeDeadline(remainingMs);
  const pipelineFetch = stubPipelineFetch(routes);
  const pipeline: PipelineClient = createServerPipeline({
    baseUrl: BASE,
    deadline,
    metrics,
    logger: quiet,
    fetch: pipelineFetch.fetch,
    sleep: () => Promise.resolve(),
  });
  let n = 0;
  const service = createLeadService({
    repository,
    pipeline,
    deadline,
    metrics,
    logger: quiet,
    now: () => NOW,
    newId: () => `01JBQ8000000000000000000${String(n++).padStart(2, '0')}`,
  });
  return { service, repository, metrics, deadline, calls: pipelineFetch.calls };
}

const META: PipelineRoute = () => ({ body: fixtureMeta() });

describe('leads.create', () => {
  it('saves a permit lead with a snapshot read from the pipeline, /v1/meta first', async () => {
    const { service, repository, calls, metrics } = setup({
      '/v1/meta': META,
      '/v1/permits/FX-1 BP': () => ({ body: fixturePermitDetail(1), requestId: 'pl-permit' }),
    });
    const result = await service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: 'FX-1 BP',
    });

    expect(calls).toEqual(['/v1/meta', '/v1/permits/FX-1 BP']);
    expect(result.outcome).toBe('created');
    expect(LeadSchema.parse(result.lead)).toEqual(result.lead);
    expect(result.lead).toMatchObject({
      property_id: 'fx-1',
      permit_id: 'FX-1 BP',
      status: 'new',
      note: '',
      created_at: NOW.toISOString(),
    });
    expect(result.lead.snapshot).toEqual({
      taken_at: NOW.toISOString(),
      run_id: 'fixture-run',
      address: { line1: '1 FIXTURE ST', city: 'TESTVILLE', zip: '00000' },
      lat: 30.251,
      lon: -97.749,
      roof_age_years: 36,
      roof_year: 1990,
      roof_age_basis: 'year_built',
      roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
      permit: {
        permit_id: 'FX-1 BP',
        basis: 'saved',
        status_group: 'open',
        status: 'Active',
        roof_work_class: 'primary_roof_replacement',
        open_since: '2021-04-01',
        open_duration_days: 2000,
        days_since_expiry: null,
        contractor_name: 'FIXTURE ROOFER',
        bbb_status: 'blocked',
        bbb_rating: null,
      },
    });
    expect(repository.writes).toBe(1);
    expect(metrics.snapshot()).toMatchObject({
      'LeadProcessed operation=create': [1],
      PipelineCallProcessed: [2],
    });
  });

  it("saves a property lead with the property's longest-open roofing permit", async () => {
    const detail = fixtureDetail(1, {
      permits: [
        fixturePermit(1, { status_group: 'closed', open_duration_days: null }),
        fixturePermit(2, {
          status_group: 'stalled',
          open_duration_days: 900,
          days_since_expiry: 30,
        }),
        fixturePermit(3, { status_group: 'open', open_duration_days: 50 }),
        fixturePermit(4, { is_roofing: false, status_group: 'open', open_duration_days: 9000 }),
      ],
    });
    const { service, calls } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => ({ body: detail }),
    });
    const { lead } = await service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
    });
    expect(calls).toEqual(['/v1/meta', '/v1/properties/fx-1']);
    expect(lead.permit_id).toBe('');
    expect(lead.snapshot.permit).toMatchObject({ permit_id: 'FX-3 BP', basis: 'longest_open' });
  });

  it('asks the permit search when the embedded permits are truncated', async () => {
    const { service, calls } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => ({
        body: fixtureDetail(1, { permits: [], permits_total: 80, permits_truncated: true }),
      }),
      '/v1/permits/search': () => ({
        body: { items: [fixturePermit(7)], total: 3, next_cursor: 'c', area_note: null },
      }),
    });
    const { lead } = await service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
    });
    expect(calls[2]).toBe(
      '/v1/permits/search?property_id=fx-1&status_group=open,stalled&roofing_only=true&limit=1',
    );
    expect(lead.snapshot.permit?.permit_id).toBe('FX-7 BP');
  });

  it('returns the existing lead without calling the pipeline', async () => {
    const routes = {
      '/v1/meta': META,
      '/v1/permits/FX-1 BP': () => ({ body: fixturePermitDetail(1) }),
    };
    const first = setup(routes);
    const created = await first.service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: 'FX-1 BP',
    });

    const second = setup(routes);
    second.repository.items.set(WORKSPACE, new Map([['fx-1#FX-1 BP', created.lead]]));
    const again = await second.service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: 'FX-1 BP',
    });
    expect(again).toEqual({ outcome: 'existing', lead: created.lead });
    expect(second.calls).toEqual([]);
  });

  it('fails a permit that is not on the named property, writing nothing', async () => {
    const { service, repository } = setup({
      '/v1/meta': META,
      '/v1/permits/FX-1 BP': () => ({ body: fixturePermitDetail(1, { property_id: 'fx-9' }) }),
    });
    const error = await service
      .create({ workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: 'FX-1 BP' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LeadRowFailure);
    expect((error as LeadRowFailure).failure.code).toBe('mismatch');
    expect(repository.writes).toBe(0);
  });

  it('reports an unknown property as not_found with the pipeline request id', async () => {
    const { service, metrics } = setup({ '/v1/meta': META });
    const error = (await service
      .create({ workspace_id: WORKSPACE, property_id: 'fx-404', permit_id: '' })
      .catch((caught: unknown) => caught)) as LeadRowFailure;
    expect(error.failure).toEqual({
      code: 'not_found',
      message: 'Not found in the pipeline API (HTTP 404: not_found).',
      pipeline_request_id: 'pl-404',
    });
    expect(metrics.snapshot()).toMatchObject({
      'LeadFailed operation=create reason=not_found': [1],
      'PipelineCallFailed status=4xx': [1],
    });
  });
});

describe('leads.createMany', () => {
  it('saves rows one at a time, reads /v1/meta once, and reports each row', async () => {
    const { service, calls } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => ({ body: fixtureDetail(1) }),
      '/v1/properties/fx-2': () => ({ body: fixtureDetail(2) }),
    });
    const { rows } = await service.createMany({
      workspace_id: WORKSPACE,
      rows: [
        { property_id: 'fx-1', permit_id: '' },
        { property_id: 'fx-404', permit_id: '' },
        { property_id: 'fx-2', permit_id: '' },
        { property_id: 'fx-1', permit_id: '' },
      ],
    });
    expect(rows.map((row) => [row.property_id, row.outcome])).toEqual([
      ['fx-1', 'created'],
      ['fx-404', 'failed'],
      ['fx-2', 'created'],
      ['fx-1', 'created'],
    ]);
    expect(calls).toEqual([
      '/v1/meta',
      '/v1/properties/fx-1',
      '/v1/properties/fx-404',
      '/v1/properties/fx-2',
    ]);
  });

  it('fails the rows it has no time left for as deadline, without writing them', async () => {
    const { service, deadline, repository } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => {
        deadline.set(2_000);
        return { body: fixtureDetail(1) };
      },
    });
    const { rows } = await service.createMany({
      workspace_id: WORKSPACE,
      rows: [
        { property_id: 'fx-1', permit_id: '' },
        { property_id: 'fx-2', permit_id: '' },
      ],
    });
    expect(rows[0]?.outcome).toBe('created');
    expect(rows[1]).toMatchObject({ outcome: 'failed', error: { code: 'deadline' } });
    expect(repository.writes).toBe(1);
  });

  it('fails every row when /v1/meta fails, after one attempt at it', async () => {
    const { service, calls } = setup({
      '/v1/meta': () => ({ status: 500, body: { error: 'internal', request_id: 'pl-500' } }),
    });
    const { rows } = await service.createMany({
      workspace_id: WORKSPACE,
      rows: [
        { property_id: 'fx-1', permit_id: '' },
        { property_id: 'fx-2', permit_id: '' },
      ],
    });
    expect(rows.map((row) => (row.outcome === 'failed' ? row.error.code : row.outcome))).toEqual([
      'pipeline',
      'pipeline',
    ]);
    // One fast 5xx is retried once by the transport; the second row reuses the failure.
    expect(calls).toEqual(['/v1/meta', '/v1/meta']);
  });
});
