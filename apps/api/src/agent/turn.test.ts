import type { Meta } from '@roofing-crm/pipeline-client';
import {
  fixtureCenter,
  fixtureDetail,
  fixtureMeta,
  fixturePermit,
  fixturePermitDetail,
  fixtureProperty,
} from '@roofing-crm/pipeline-client/testing';
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { createLeadService } from '../leads/service';
import { RequestMetrics } from '../observability';
import { createServerPipeline } from '../pipeline';
import {
  MemoryRepository,
  WORKSPACE,
  fakeDeadline,
  stubPipelineFetch,
  type PipelineRoute,
} from '../test/helpers';
import { PROMPT_VERSION } from './prompt';
import { runTurn, type TurnDeps, type TurnInput } from './turn';

// The turn with a scripted model (ai/test) over the real tools, the real pipeline client against a
// stubbed fetch with synthetic contract fixtures, and the lead service over an in-memory table.

const META = {
  ...fixtureMeta(),
  county: 'Travis County, TX',
  fips: '48453',
  deploy: { deploy_id: 'fx-deploy' },
  counts: {
    properties: 1000,
    with_roof_age: 900,
    permits: 5000,
    roofing_permits: 800,
    open_roofing_permits: 50,
    stalled_roofing_permits: 40,
    roofing_permits_needs_review: 5,
    permit_contractor_attributions: 700,
  },
  limitations: [
    { source: 'bbb.org', incomplete_reason: 'blocked', detail: 'BBB blocks automated access.' },
    { source: 'fixture-roll', incomplete_reason: 'partial_history', detail: 'Partial history.' },
  ],
} as unknown as Meta;

const usage = (out: number) => ({
  inputTokens: { total: 1000, noCache: 400, cacheRead: 500, cacheWrite: 100 },
  outputTokens: { total: out, text: out, reasoning: 0 },
});
const text = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  finishReason: { unified: 'stop' as const, raw: 'end_turn' },
  usage: usage(50),
  warnings: [],
});
const call = (id: string, name: string, input: unknown) => ({
  content: [
    { type: 'tool-call' as const, toolCallId: id, toolName: name, input: JSON.stringify(input) },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
  usage: usage(60),
  warnings: [],
});

const CENTER = fixtureCenter({ name: 'AUSTIN', lat: 30.2672, lon: -97.7431 });
const ROUTES: Record<string, PipelineRoute> = {
  '/v1/search-centers': () => ({ body: { items: [CENTER] } }),
  '/v1/permits/search': () => ({
    body: {
      items: [
        fixturePermit(1, { open_duration_days: 3000 }),
        fixturePermit(2, { property_id: 'fx-2' }),
      ],
      total: 2,
      next_cursor: null,
      area_note: null,
    },
    requestId: 'pl-permits',
  }),
  '/v1/properties/search': () => ({
    body: { items: [fixtureProperty(1)], total: 1, next_cursor: null, area_note: null },
  }),
  '/v1/meta': () => ({ body: META }),
  '/v1/properties/fx-1': () => ({ body: fixtureDetail(1) }),
  '/v1/permits/FX-1 BP': () => ({ body: fixturePermitDetail(1) }),
};

function setup(steps: unknown[], routes: Record<string, PipelineRoute> = ROUTES) {
  const repository = new MemoryRepository();
  const metrics = new RequestMetrics();
  const deadline = fakeDeadline();
  const quiet = { info: () => undefined, warn: () => undefined };
  const fetch = stubPipelineFetch(routes);
  const pipeline = createServerPipeline({
    baseUrl: 'https://pipeline.example.org',
    deadline,
    metrics,
    logger: quiet,
    fetch: fetch.fetch,
    sleep: () => Promise.resolve(),
  });
  let n = 0;
  const leads = createLeadService({
    repository,
    pipeline,
    deadline,
    metrics,
    logger: quiet,
    newId: () => `01JBQ8000000000000000000${String(n++).padStart(2, '0')}`,
  });
  const deps: TurnDeps = {
    model: new MockLanguageModelV4({ doGenerate: steps as never }),
    modelId: 'us.anthropic.claude-sonnet-4-6',
    langsmith: {
      tracingEnabled: false,
      ToolLoopAgent,
      providerOptions: () => ({}),
      flush: () => Promise.resolve(),
    },
    pipeline,
    leads,
    meta: META,
  };
  return { deps, repository, calls: fetch.calls };
}

const input = (question: string, extra: Partial<TurnInput> = {}): TurnInput => ({
  messages: [{ role: 'user', content: question }],
  sessionId: 's1',
  requestId: 'crm-req-1',
  workspaceId: WORKSPACE,
  mapCenter: null,
  receivedAt: Date.now(),
  ...extra,
});

const README_QUESTION =
  'Show me open roofing permits older than five years within five miles of Austin';
const PERMIT_ARGS = {
  lat: CENTER.lat,
  lon: CENTER.lon,
  radius_miles: 5,
  status_group: ['open', 'stalled'],
  roofing_only: true,
  min_open_years: 5,
};

describe('runTurn', () => {
  it("answers the README's question from the tools, with evidence, assumptions and limitations", async () => {
    const { deps, calls } = setup([
      call('t1', 'resolve_search_center', { q: 'Austin' }),
      call('t2', 'search_permits', PERMIT_ARGS),
      text(
        'OUTCOME: answered\nASSUMPTION: "older than five years" read as open five years or more.\n\nTwo long-open permits:\n- [[permit:FX-1 BP]] on [[property:fx-1]], open 8.2 years.',
      ),
    ]);
    const result = await runTurn(deps, input(README_QUESTION));
    expect(result.kind).toBe('response');
    if (result.kind !== 'response') return;
    const { body } = result;
    expect(body).toMatchObject({
      outcome: 'answered',
      answer: 'Two long-open permits:\n- [[permit:FX-1 BP]] on [[property:fx-1]], open 8.2 years.',
      center_used: { name: 'AUSTIN', kind: 'city', lat: 30.2672, lon: -97.7431 },
      leads_created: [],
      run_id: 'fixture-run',
      model_id: 'us.anthropic.claude-sonnet-4-6',
      prompt_version: PROMPT_VERSION,
      request_id: 'crm-req-1',
    });
    expect(body.tool_calls.map((c) => [c.name, c.status, c.total])).toEqual([
      ['resolve_search_center', 'ok', 1],
      ['search_permits', 'ok', 2],
    ]);
    expect(body.evidence.map((e) => [e.kind, e.permit_id ?? e.property_id ?? e.label])).toEqual([
      ['search_center', 'AUSTIN (city)'],
      ['permit', 'FX-1 BP'],
      ['contractor', 'FX-1 BP'],
      ['permit', 'FX-2 BP'],
      ['contractor', 'FX-2 BP'],
    ]);
    expect(body.assumptions[0]).toMatch(/older than five years/);
    expect(body.assumptions.some((line) => line.startsWith('Search center AUSTIN'))).toBe(true);
    expect(body.limitations.map((l) => l.source)).toEqual([
      'bbb.org',
      'austin-issued-construction-permits/3syk-w9eu',
    ]);
    expect(calls.at(-1)).toContain('min_open_years=5');
    expect(calls.at(-1)).toContain('status_group=open,stalled');
    expect(result.stats).toMatchObject({ steps: 3, tool_calls: 2, cited: 2, input_tokens: 3000 });
  });

  it('returns no model text when the answer cites an id no tool returned', async () => {
    const { deps } = setup([
      call('t1', 'search_properties', { roof_age_min: 15, open_permits: false }),
      text('OUTCOME: answered\n\nSee [[property:999999]] and permit 2019-123456 BP.'),
    ]);
    const result = await runTurn(deps, input('Roofs older than 15 years county-wide?'));
    if (result.kind !== 'response') throw new Error('expected a response');
    expect(result.body).toMatchObject({ outcome: 'tool_error', answer: '' });
    expect(result.stats.citation_failures).toBe(2);
    expect(result.body.evidence.map((e) => e.property_id)).toEqual(['fx-1']);
  });

  it('refuses a search around a point no tool returned, and allows the map pin', async () => {
    const invented = { lat: 30.5, lon: -97.9, roof_age_min: 15, open_permits: false };
    const { deps, calls } = setup([
      call('t1', 'search_properties', invented),
      text('OUTCOME: needs_clarification\n\nWhich area do you mean?'),
    ]);
    const refused = await runTurn(deps, input('Old roofs around here?'));
    if (refused.kind !== 'response') throw new Error('expected a response');
    expect(refused.body.tool_calls[0]).toMatchObject({
      name: 'search_properties',
      status: 'error',
    });
    expect(refused.body.tool_calls[0]?.result_summary).toMatch(/^coordinates_not_allowed/);
    expect(calls).toEqual([]);

    const pin = { lat: 30.3, lon: -97.7 };
    const allowed = setup([
      call('t1', 'search_properties', { ...pin, roof_age_min: 15, open_permits: false }),
      text('OUTCOME: answered\n\nOne roof: [[property:fx-1]].'),
    ]);
    const answered = await runTurn(
      allowed.deps,
      input('Old roofs around here?', { mapCenter: pin }),
    );
    if (answered.kind !== 'response') throw new Error('expected a response');
    expect(answered.body.outcome).toBe('answered');
    expect(answered.body.center_used).toEqual({ name: "Map's pin", kind: 'map_pin', ...pin });
  });

  it('saves a lead only when asked, and only with an id a tool returned in this turn', async () => {
    const steps = [
      call('t1', 'search_permits', { ...PERMIT_ARGS, lat: undefined, lon: undefined }),
      call('t2', 'create_lead', { property_id: 'fx-1', permit_id: 'FX-1 BP' }),
      call('t3', 'create_lead', { property_id: 'fx-77' }),
      text('OUTCOME: answered\n\nSaved [[permit:FX-1 BP]] as a lead.'),
    ];
    const notAsked = setup(steps);
    const quiet = await runTurn(notAsked.deps, input('Long-open roofing permits county-wide?'));
    if (quiet.kind !== 'response') throw new Error('expected a response');
    expect(quiet.body.tool_calls[1]?.result_summary).toMatch(/^not_requested/);
    expect(quiet.body.leads_created).toEqual([]);
    expect(notAsked.repository.items.size).toBe(0);

    const asked = setup(steps);
    const saved = await runTurn(
      asked.deps,
      input('Find long-open roofing permits and save the first as a lead'),
    );
    if (saved.kind !== 'response') throw new Error('expected a response');
    expect(saved.body.leads_created).toEqual([
      {
        lead_id: expect.any(String) as string,
        property_id: 'fx-1',
        permit_id: 'FX-1 BP',
        outcome: 'created',
      },
    ]);
    expect(saved.body.tool_calls[2]?.result_summary).toMatch(
      /^unknown_id: no tool returned property fx-77/,
    );
    expect((await asked.repository.get(WORKSPACE, 'fx-1#FX-1 BP'))?.snapshot.permit?.basis).toBe(
      'saved',
    );
  });

  it("lists the workspace's leads with the Leads page's filter and cites their properties", async () => {
    const { deps } = setup([
      call('t1', 'create_lead', { property_id: 'fx-1' }),
      text('OUTCOME: answered\n\nok'),
    ]);
    // A lead saved earlier, through the same service.
    await deps.leads.create({ workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: '' });
    const list = setup([
      call('t1', 'list_leads', { statuses: ['new'], roof_age_min: 30 }),
      text('OUTCOME: answered\n\nOne lead: [[property:fx-1]], roof 36 years (year built).'),
    ]);
    await list.deps.leads.create({ workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: '' });
    const result = await runTurn(
      list.deps,
      input('Which of my new leads have roofs older than 30?'),
    );
    if (result.kind !== 'response') throw new Error('expected a response');
    expect(result.body.outcome).toBe('answered');
    expect(result.body.evidence).toEqual([
      expect.objectContaining({
        kind: 'lead',
        property_id: 'fx-1',
        label: '1 FIXTURE ST, TESTVILLE 00000',
      }),
    ]);
    expect(result.body.assumptions).toContain(
      "Leads are matched on the snapshot saved with each lead, not on today's data.",
    );
  });

  it('ends with limit_reached and the evidence so far when the deadline passes', async () => {
    const { deps } = setup([
      call('t1', 'search_properties', { roof_age_min: 15, open_permits: false }),
      text('OUTCOME: answered\n\nnever reached'),
    ]);
    const result = await runTurn(
      { ...deps, limits: { deadlineMs: 3_600 } },
      input('Old roofs?', { receivedAt: Date.now() - 1_000 }),
    );
    if (result.kind !== 'response') throw new Error('expected a response');
    expect(result.body.outcome).toBe('limit_reached');
    expect(result.stats.deadline_hit).toBe(true);
  });

  it('reports a model the account cannot use as model_unavailable', async () => {
    const denied = Object.assign(new Error('AccessDeniedException: no access to this model'), {
      statusCode: 403,
    });
    const { deps } = setup([]);
    const result = await runTurn(
      {
        ...deps,
        model: new MockLanguageModelV4({
          doGenerate: () => Promise.reject(denied),
        }),
      },
      input('Old roofs?'),
    );
    expect(result.kind).toBe('model_unavailable');
  });

  it('declines an off-topic question without a tool call, and never claims answered without one', async () => {
    const { deps } = setup([
      text('OUTCOME: out_of_scope\n\nI answer questions about roofs and leads.'),
    ]);
    const result = await runTurn(deps, input('Write me a poem'));
    if (result.kind !== 'response') throw new Error('expected a response');
    expect(result.body).toMatchObject({ outcome: 'out_of_scope', tool_calls: [], evidence: [] });

    const invented = setup([text('OUTCOME: answered\n\nThere are 12 open permits.')]);
    const claimed = await runTurn(invented.deps, input('How many open permits?'));
    if (claimed.kind !== 'response') throw new Error('expected a response');
    expect(claimed.body).toMatchObject({ outcome: 'tool_error', answer: '' });
  });
});
