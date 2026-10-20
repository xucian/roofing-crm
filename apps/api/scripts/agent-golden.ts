// The agent's golden set (fixtures/agent/golden.json; alakazam review item 7): every case is asked
// in order, in one fresh workspace, and its tool calls, parameters, outcome, evidence and lead rules
// are checked; the prose never is.
//
//   pnpm agent:golden                 in-process: the agent handler with the live pipeline and Bedrock
//                                     (AWS credentials of the shell, e.g. AWS_PROFILE=cdk-lab), an
//                                     in-memory leads table, no daily cap, LangSmith only if
//                                     LANGSMITH_API_KEY is set
//   pnpm agent:golden --url <WebUrl>  the deployed agent through CloudFront
//
// Each turn costs about $0.02 of Bedrock. Results go to fixtures/agent/results/ (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_NAME, ulid, type ChatResponse } from '@roofing-crm/shared';
import { handleAgentRequest, type AgentHandlerDeps } from '../src/agent-handler';
import { CircuitBreaker } from '../src/agent/governor';
import { PLAIN_FACADE, langSmithLoader } from '../src/agent/langsmith';
import { DEFAULT_MODEL_ID, bedrockModel } from '../src/agent/model';
import { MemoryRepository, httpEvent } from '../src/test/helpers';

interface GoldenCase {
  id: string;
  question: string;
  outcomes: string[];
  tools_in_order?: string[];
  params?: Record<string, Record<string, unknown>>;
  absent_params?: Record<string, string[]>;
  forbid_tools?: string[];
  min_evidence?: Record<string, number>;
  max_evidence?: Record<string, number>;
  max_tool_calls?: number;
  leads_created?: number;
  center_kind?: string;
  answer_mentions?: string;
}

interface Golden {
  map_center: { lat: number; lon: number };
  cases: GoldenCase[];
}

const ROOT = resolve(import.meta.dirname, '../../..');
const golden = JSON.parse(readFileSync(join(ROOT, 'fixtures/agent/golden.json'), 'utf8')) as Golden;

/** Every failed expectation of one case; empty when it passes. */
export function check(expected: GoldenCase, answer: ChatResponse): string[] {
  const problems: string[] = [];
  const names = answer.tool_calls.map((call) => call.name);
  if (!expected.outcomes.includes(answer.outcome)) {
    problems.push(`outcome ${answer.outcome}, expected ${expected.outcomes.join(' or ')}`);
  }
  let from = 0;
  for (const name of expected.tools_in_order ?? []) {
    const at = names.indexOf(name, from);
    if (at < 0) problems.push(`no ${name} call (in order) among ${names.join(', ') || 'none'}`);
    else from = at + 1;
  }
  for (const name of expected.forbid_tools ?? []) {
    if (names.includes(name)) problems.push(`called ${name}`);
  }
  for (const [name, params] of Object.entries(expected.params ?? {})) {
    const calls = answer.tool_calls.filter((call) => call.name === name && call.status === 'ok');
    const matched = calls.some((call) =>
      Object.entries(params).every(([key, value]) => {
        const actual = call.args[key];
        return typeof value === 'number' && typeof actual === 'number'
          ? Math.abs(actual - value) < 1e-3
          : JSON.stringify(actual) === JSON.stringify(value);
      }),
    );
    if (!matched) {
      problems.push(
        `no ok ${name} call with ${JSON.stringify(params)}; got ${JSON.stringify(calls.map((call) => call.args))}`,
      );
    }
  }
  for (const [name, keys] of Object.entries(expected.absent_params ?? {})) {
    for (const call of answer.tool_calls.filter((entry) => entry.name === name)) {
      for (const key of keys)
        if (call.args[key] !== undefined) problems.push(`${name} sent ${key}`);
    }
  }
  const count = (kind: string) => answer.evidence.filter((item) => item.kind === kind).length;
  for (const [kind, min] of Object.entries(expected.min_evidence ?? {})) {
    if (count(kind) < min)
      problems.push(`${String(count(kind))} ${kind} records, expected >= ${String(min)}`);
  }
  for (const [kind, max] of Object.entries(expected.max_evidence ?? {})) {
    if (count(kind) > max)
      problems.push(`${String(count(kind))} ${kind} records, expected <= ${String(max)}`);
  }
  if (expected.max_tool_calls !== undefined && names.length > expected.max_tool_calls) {
    problems.push(
      `${String(names.length)} tool calls, expected <= ${String(expected.max_tool_calls)}`,
    );
  }
  if (expected.leads_created !== undefined) {
    const created = answer.leads_created.filter((lead) => lead.outcome === 'created').length;
    if (created !== expected.leads_created) {
      problems.push(`${String(created)} leads created, expected ${String(expected.leads_created)}`);
    }
  }
  if (expected.center_kind && answer.center_used?.kind !== expected.center_kind) {
    problems.push(`center ${answer.center_used?.kind ?? 'none'}, expected ${expected.center_kind}`);
  }
  if (expected.answer_mentions && !answer.answer.includes(expected.answer_mentions)) {
    problems.push(`answer does not mention ${expected.answer_mentions}`);
  }
  return problems;
}

type Ask = (input: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;

function inProcess(): Ask {
  const pin = JSON.parse(
    readFileSync(join(ROOT, 'packages/pipeline-client/openapi.pin.json'), 'utf8'),
  ) as { apiBase: string };
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
  const deps: AgentHandlerDeps = {
    config: {
      leadsTable: 'golden-in-memory',
      pipelineApiBase: process.env.PIPELINE_API_BASE ?? pin.apiBase,
    },
    modelId,
    model: bedrockModel(modelId, process.env.AWS_REGION ?? 'us-east-2'),
    langsmith: process.env.LANGSMITH_API_KEY
      ? langSmithLoader({
          LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
          LANGSMITH_PROJECT: AGENT_NAME,
        })
      : () => Promise.resolve(PLAIN_FACADE),
    repository: new MemoryRepository(),
    usage: { take: () => Promise.resolve(true), addTokens: () => Promise.resolve() },
    breaker: new CircuitBreaker(),
  };
  let n = 0;
  return async (input) => {
    const event = httpEvent({ method: 'POST', path: '/api/trpc/agent.chat', body: input });
    event.requestContext.requestId = `golden-${String((n += 1))}`;
    event.requestContext.timeEpoch = Date.now();
    const result = await handleAgentRequest(
      event,
      { getRemainingTimeInMillis: () => 29_000 },
      deps,
    );
    return { status: result.statusCode ?? 0, body: JSON.parse(result.body ?? 'null') as unknown };
  };
}

function overHttp(url: string): Ask {
  return async (input) => {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/trpc/agent.chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(35_000),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { url: { type: 'string' }, only: { type: 'string' } },
    allowPositionals: true,
  });
  const ask = values.url ? overHttp(values.url) : inProcess();
  const workspace = ulid();
  const rows: Record<string, unknown>[] = [];
  let failed = 0;
  console.log(`Golden set: ${values.url ?? 'in-process'}, workspace ${workspace}`);
  for (const expected of golden.cases) {
    if (values.only && expected.id !== values.only) continue;
    const started = Date.now();
    const { status, body } = await ask({
      workspace_id: workspace,
      messages: [{ role: 'user', content: expected.question }],
      map_center: golden.map_center,
    });
    const ms = Date.now() - started;
    const answer = (body as { result?: { data?: ChatResponse } }).result?.data;
    const problems = answer
      ? check(expected, answer)
      : [`HTTP ${String(status)}: ${JSON.stringify(body).slice(0, 300)}`];
    if (problems.length > 0) failed += 1;
    console.log(
      `${problems.length === 0 ? 'PASS' : 'FAIL'} ${expected.id} ${answer?.outcome ?? status} ${String(ms)} ms [${answer?.tool_calls.map((call) => call.name).join(' > ') ?? ''}] ${answer?.request_id ?? ''}`,
    );
    for (const problem of problems) console.log(`     - ${problem}`);
    rows.push({
      id: expected.id,
      pass: problems.length === 0,
      problems,
      ms,
      outcome: answer?.outcome ?? null,
      tool_calls: answer?.tool_calls ?? [],
      evidence: answer?.evidence.length ?? 0,
      leads_created: answer?.leads_created ?? [],
      request_id: answer?.request_id ?? null,
      answer: answer?.answer ?? null,
    });
  }
  const outDir = join(ROOT, 'fixtures/agent/results');
  mkdirSync(outDir, { recursive: true });
  const file = join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, '')}-${values.url ? 'url' : 'local'}.json`,
  );
  writeFileSync(
    file,
    `${JSON.stringify({ target: values.url ?? 'in-process', workspace, rows }, null, 2)}\n`,
  );
  const times = rows.map((row) => row.ms as number).sort((a, b) => a - b);
  console.log(
    `\n${String(rows.length - failed)}/${String(rows.length)} passed; p50 ${String(times[Math.floor(times.length / 2)] ?? 0)} ms, max ${String(times.at(-1) ?? 0)} ms. Results: ${file}`,
  );
  if (failed > 0) process.exitCode = 1;
}

await main();
