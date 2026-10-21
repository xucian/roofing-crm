import { fixtureMeta, fixtureProperty } from '@roofing-crm/pipeline-client/testing';
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handleAgentRequest, type AgentHandlerDeps } from './agent-handler';
import { CircuitBreaker } from './agent/governor';
import type { DailyUsage } from './agent/usage';
import { MemoryRepository, WORKSPACE, httpEvent, stubPipelineFetch } from './test/helpers';

// The agent function through its own route, with a scripted model and the pipeline stubbed.

const META = {
  ...fixtureMeta(),
  county: 'Travis County, TX',
  fips: '48453',
  deploy: { deploy_id: 'fx-deploy' },
  counts: {
    properties: 1,
    with_roof_age: 1,
    roofing_permits: 0,
    open_roofing_permits: 0,
    stalled_roofing_permits: 0,
    roofing_permits_needs_review: 0,
    permit_contractor_attributions: 0,
  },
  limitations: [],
};

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};
const steps = [
  {
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 't1',
        toolName: 'search_properties',
        input: JSON.stringify({ roof_age_min: 15, open_permits: false }),
      },
    ],
    finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
    usage,
    warnings: [],
  },
  {
    content: [{ type: 'text' as const, text: 'OUTCOME: answered\n\nOne: [[property:fx-1]].' }],
    finishReason: { unified: 'stop' as const, raw: 'end_turn' },
    usage,
    warnings: [],
  },
];

function deps(extra: Partial<AgentHandlerDeps> = {}) {
  const counted: number[] = [];
  const usageStore: DailyUsage = {
    take: () => Promise.resolve(true),
    addTokens: (_, tokens) => {
      counted.push(tokens);
      return Promise.resolve();
    },
  };
  const pipeline = stubPipelineFetch({
    '/v1/meta': () => ({ body: META }),
    '/v1/properties/search': () => ({
      body: { items: [fixtureProperty(1)], total: 1, next_cursor: null, area_note: null },
    }),
  });
  const handlerDeps: AgentHandlerDeps = {
    config: { leadsTable: 'Leads', pipelineApiBase: 'https://pipeline.example.org' },
    modelId: 'us.anthropic.claude-sonnet-4-6',
    model: new MockLanguageModelV4({ doGenerate: steps as never }),
    langsmith: () =>
      Promise.resolve({
        tracingEnabled: false,
        ToolLoopAgent,
        providerOptions: () => ({}),
        flush: () => Promise.resolve(),
      }),
    repository: new MemoryRepository(),
    usage: usageStore,
    breaker: new CircuitBreaker(),
    fetch: pipeline.fetch,
    ...extra,
  };
  return { handlerDeps, counted, calls: pipeline.calls };
}

const chat = (body: unknown): APIGatewayProxyEventV2 => {
  const event = httpEvent({ method: 'POST', path: '/api/trpc/agent.chat', body });
  return { ...event, requestContext: { ...event.requestContext, timeEpoch: Date.now() } };
};
const lambda = { getRemainingTimeInMillis: () => 29_000 };
const question = { workspace_id: WORKSPACE, messages: [{ role: 'user', content: 'Old roofs?' }] };

async function call(event: APIGatewayProxyEventV2, handlerDeps: AgentHandlerDeps) {
  const result = await handleAgentRequest(event, lambda, handlerDeps);
  return { result, body: JSON.parse(result.body ?? 'null') as Record<string, unknown> };
}

describe('the agent function', () => {
  it('answers agent.chat on its own route: /v1/meta first, the turn, the tokens counted', async () => {
    const { handlerDeps, counted, calls } = deps();
    const { result, body } = await call(chat(question), handlerDeps);
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ 'x-request-id': 'crm-req-1' });
    expect(body).toMatchObject({
      result: {
        data: {
          outcome: 'answered',
          answer: 'One: [[property:fx-1]].',
          save_offer: [],
          request_id: 'crm-req-1',
          model_id: 'us.anthropic.claude-sonnet-4-6',
        },
      },
    });
    expect(calls[0]).toBe('/v1/meta');
    expect(counted).toEqual([240]);
  });

  it('refuses a history over the bounds, or one that does not end with the user, with 400', async () => {
    const { handlerDeps, calls } = deps();
    const long = { ...question, messages: [{ role: 'user', content: 'x'.repeat(4001) }] };
    expect((await call(chat(long), handlerDeps)).result.statusCode).toBe(400);
    const ends = {
      ...question,
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    };
    expect((await call(chat(ends), handlerDeps)).result.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 503 with the reason when the day is used up, without calling the pipeline', async () => {
    const { handlerDeps, calls } = deps({
      usage: { take: () => Promise.resolve(false), addTokens: () => Promise.resolve() },
    });
    const { result, body } = await call(chat(question), handlerDeps);
    expect(result.statusCode).toBe(503);
    expect(body).toMatchObject({
      error: {
        data: { code: 'SERVICE_UNAVAILABLE', reason: 'budget_exhausted', requestId: 'crm-req-1' },
      },
    });
    expect(calls).toEqual([]);
  });

  it('answers 502 with the pipeline request id when /v1/meta fails', async () => {
    const pipeline = stubPipelineFetch({
      '/v1/meta': () => ({
        status: 500,
        body: { error: 'internal', request_id: 'pl-500' },
        requestId: 'pl-500',
      }),
    });
    const { handlerDeps } = deps({ fetch: pipeline.fetch });
    const { result, body } = await call(chat(question), handlerDeps);
    expect(result.statusCode).toBe(502);
    expect(body).toMatchObject({
      error: { data: { failure: { code: 'pipeline', pipeline_request_id: 'pl-500' } } },
    });
  });
});
