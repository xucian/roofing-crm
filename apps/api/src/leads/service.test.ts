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
import { LeadNotFound, LeadRowFailure, createLeadService, describeFilter } from './service';

const BASE = 'https://pipeline.example.org';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const quiet = { info: () => undefined, warn: () => undefined };

interface LogLine {
  message: string;
  fields: Record<string, unknown>;
}

/** A logger that keeps its lines, to check what a log line says and does not say. */
function recordingLogger(): { lines: LogLine[]; info: Logged; warn: Logged } {
  const lines: LogLine[] = [];
  const log: Logged = (message, ...extra) => {
    lines.push({ message: String(message), fields: (extra[0] ?? {}) as Record<string, unknown> });
  };
  return { lines, info: log, warn: log };
}
type Logged = (message: unknown, ...extra: unknown[]) => void;

function setup(
  routes: Record<string, PipelineRoute>,
  remainingMs = 25_000,
  logger: { info: Logged; warn: Logged } = quiet,
) {
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
    logger,
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

  it('keeps a roof job with no completed date before a longer-open shed or a completed job', async () => {
    const detail = fixtureDetail(1, {
      permits: [
        fixturePermit(1, { roof_work_class: 'accessory_roof', open_duration_days: 9000 }),
        fixturePermit(2, { open_duration_days: 8000, completed_date: '2001-01-01' }),
        fixturePermit(3, {
          roof_work_class: 'repair_or_coating',
          status_group: 'stalled',
          open_duration_days: 3000,
        }),
      ],
    });
    const { service } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => ({ body: detail }),
    });
    const { lead } = await service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
    });
    expect(lead.snapshot.permit).toMatchObject({
      permit_id: 'FX-3 BP',
      basis: 'longest_open',
      roof_work_class: 'repair_or_coating',
    });
  });

  it('falls back to the longest-open roofing permit when no roof job qualifies', async () => {
    const detail = fixtureDetail(1, {
      permits: [
        fixturePermit(1, { open_duration_days: 8000, completed_date: '2001-01-01' }),
        fixturePermit(2, { roof_work_class: 'accessory_roof', open_duration_days: 9000 }),
      ],
    });
    const { service } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => ({ body: detail }),
    });
    const { lead } = await service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
    });
    expect(lead.snapshot.permit).toMatchObject({ permit_id: 'FX-2 BP', basis: 'longest_open' });
  });

  it('asks the permit search when the embedded permits are truncated, and picks by the same rule', async () => {
    const { service, calls } = setup({
      '/v1/meta': META,
      '/v1/properties/fx-1': () => ({
        body: fixtureDetail(1, { permits: [], permits_total: 80, permits_truncated: true }),
      }),
      '/v1/permits/search': () => ({
        body: {
          items: [
            fixturePermit(6, { roof_work_class: 'accessory_roof', open_duration_days: 9000 }),
            fixturePermit(7),
          ],
          total: 3,
          next_cursor: 'c',
          area_note: null,
        },
      }),
    });
    const { lead } = await service.create({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
    });
    expect(calls[2]).toBe(
      '/v1/permits/search?property_id=fx-1&status_group=open,stalled&roofing_only=true&limit=50',
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

describe('managing leads (F4)', () => {
  const LATER = '2026-10-20T12:00:00.000Z';

  async function withLeads(logger = recordingLogger()) {
    const context = setup(
      {
        '/v1/meta': META,
        '/v1/properties/fx-1': () => ({ body: fixtureDetail(1) }),
        '/v1/properties/fx-2': () => ({ body: fixtureDetail(2, { permits: [] }) }),
      },
      25_000,
      logger,
    );
    await context.service.createMany({
      workspace_id: WORKSPACE,
      rows: [
        { property_id: 'fx-1', permit_id: '' },
        { property_id: 'fx-2', permit_id: '' },
      ],
    });
    logger.lines.length = 0;
    return { ...context, logger };
  }

  it('sets the status and the note, keeps the snapshot, and logs no note', async () => {
    const { service, repository, metrics, logger } = await withLeads();
    const before = await repository.get(WORKSPACE, 'fx-1#');
    const { lead } = await service.update({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
      status: 'working',
      note: 'Owner asked for a quote in spring.',
    });
    expect(lead).toEqual({
      ...before,
      status: 'working',
      note: 'Owner asked for a quote in spring.',
      updated_at: LATER,
    });
    expect(LeadSchema.parse(lead)).toEqual(lead);
    expect(metrics.snapshot()).toMatchObject({ 'LeadProcessed operation=update': [1] });
    expect(logger.lines).toEqual([
      {
        message: 'lead updated',
        fields: expect.objectContaining({
          property_id: 'fx-1',
          fields: ['status', 'note'],
          status: 'working',
          note_length: 34,
        }) as Record<string, unknown>,
      },
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain('quote');
  });

  it('changes only the field given', async () => {
    const { service } = await withLeads();
    await service.update({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
      note: 'x',
    });
    const { lead } = await service.update({
      workspace_id: WORKSPACE,
      property_id: 'fx-1',
      permit_id: '',
      status: 'closed',
    });
    expect(lead).toMatchObject({ status: 'closed', note: 'x' });
  });

  it('refuses to edit a lead the workspace does not have, writing nothing', async () => {
    const { service, repository } = await withLeads();
    const writes = repository.writes;
    await expect(
      service.update({
        workspace_id: WORKSPACE,
        property_id: 'fx-9',
        permit_id: '',
        status: 'closed',
      }),
    ).rejects.toBeInstanceOf(LeadNotFound);
    await expect(
      service.update({
        workspace_id: '01JBQ7Z0000000000000000009',
        property_id: 'fx-1',
        permit_id: '',
        note: 'x',
      }),
    ).rejects.toBeInstanceOf(LeadNotFound);
    expect(repository.writes).toBe(writes);
  });

  it('deletes a lead once; deleting it again answers missing', async () => {
    const { service, repository, metrics, logger } = await withLeads();
    const ref = { workspace_id: WORKSPACE, property_id: 'fx-2', permit_id: '' };
    await expect(service.delete(ref)).resolves.toEqual({ outcome: 'deleted' });
    await expect(service.delete(ref)).resolves.toEqual({ outcome: 'missing' });
    await expect(repository.get(WORKSPACE, 'fx-2#')).resolves.toBeNull();
    await expect(repository.get(WORKSPACE, 'fx-1#')).resolves.not.toBeNull();
    expect(logger.lines.map((line) => [line.message, line.fields.outcome])).toEqual([
      ['lead deleted', 'deleted'],
      ['lead not deleted', 'missing'],
    ]);
    expect(metrics.snapshot()).toMatchObject({ 'LeadProcessed operation=delete': [2] });
  });

  it('lists the leads the filter keeps, and logs the filter without its point', async () => {
    const { service, logger } = await withLeads();
    // fx-2 has no permit in its fixture detail, so only fx-1 has an open one.
    const page = await service.list({
      workspace_id: WORKSPACE,
      limit: 100,
      filter: {
        permit_groups: ['open'],
        within: { lat: 30.25, lon: -97.75, radius_miles: 5 },
      },
    });
    expect(page.items.map((lead) => lead.property_id)).toEqual(['fx-1']);
    expect(page.next_cursor).toBeNull();
    expect(logger.lines).toEqual([
      {
        message: 'leads listed',
        fields: {
          filter: { permit_groups: ['open'], within_miles: 5 },
          returned: 1,
          scanned: 2,
          has_more: false,
        },
      },
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain('97.75');

    const none = await service.list({
      workspace_id: WORKSPACE,
      limit: 100,
      filter: { statuses: [] },
    });
    expect(none.items).toEqual([]);
    const all = await service.list({ workspace_id: WORKSPACE, limit: 100 });
    expect(all.items).toHaveLength(2);
    expect(describeFilter(undefined)).toBeNull();
  });
});
