import { createHash } from 'node:crypto';
import type { Meta, PipelineClient } from '@roofing-crm/pipeline-client';
import type { ChatMessage, ChatOutcome, ChatResponse, GeoPoint } from '@roofing-crm/shared';
import { isStepCount, type ModelMessage, type wrapLanguageModel } from 'ai';
import type { LeadService } from '../leads/service';
import { BEDROCK_PROMPT_CACHE_METADATA } from './bedrock-prompt-cache';
import { checkCitations } from './citations';
import { EvidenceCollector, centerUsed, turnAssumptions, turnLimitations } from './evidence';
import {
  DeadlineError,
  OutputBudgetError,
  TurnBudget,
  classifyBedrockError,
  type BedrockFailure,
} from './governor';
import { CoordinateGuard } from './guard';
import type { LangSmithFacade } from './langsmith';
import { PROMPT_VERSION, parseFinalMessage, pinInstruction, systemPrompt } from './prompt';
import { sanitizeAnswer } from './sanitize';
import { asksToSaveLeads, buildTurnTools, type ToolCallRecord } from './tools';

type WrappedModel = Parameters<typeof wrapLanguageModel>[0]['model'];

export interface TurnLimits {
  deadlineMs: number;
  reserveMs: number;
  maxOutputTokens: number;
  stepOutputTokens: number;
  maxSteps: number;
}

/** The turn's limits (metagross item 13): 25 s from receipt, 1,500 output tokens, 6 model steps. */
export const TURN_LIMITS: Readonly<TurnLimits> = {
  deadlineMs: 25_000,
  /** Kept free at the end of the deadline to build the answer and flush the traces. */
  reserveMs: 2_000,
  maxOutputTokens: 1_500,
  stepOutputTokens: 700,
  maxSteps: 6,
};

/** What one turn reports to its log line and metrics: ids, counts, hashes and timings, never text. */
export interface TurnStats {
  outcome: ChatOutcome;
  steps: number;
  tool_calls: number;
  tool_errors: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model_ms: number;
  turn_ms: number;
  deadline_hit: boolean;
  citation_failures: number;
  bedrock_throttles: number;
  retries: number;
  evidence: number;
  cited: number;
  leads_created: number;
  question_sha256: string;
  answer_sha256: string | null;
  /** Why the model call failed: the error's name, HTTP status and message (never the user's text). */
  model_error: string | null;
  /** The first reasons the citation check withheld the answer (ids and kinds only). */
  citation_failure_reasons: string[];
}

export type TurnResult =
  | {
      kind: 'response';
      body: ChatResponse;
      stats: TurnStats;
      bedrockFailure: BedrockFailure | null;
    }
  | { kind: 'model_unavailable'; stats: TurnStats };

export interface TurnDeps {
  /** The Bedrock model wrapped with prompt caching; the turn adds its budget around it. */
  model: WrappedModel;
  modelId: string;
  langsmith: LangSmithFacade;
  pipeline: PipelineClient;
  leads: LeadService;
  /** The pipeline's /v1/meta, read first by the caller (it takes the pipeline's cold start). */
  meta: Meta;
  logToolCall?: (record: ToolCallRecord) => void;
  limits?: Partial<TurnLimits>;
  now?: () => number;
}

export interface TurnInput {
  messages: ChatMessage[];
  sessionId: string | undefined;
  requestId: string;
  workspaceId: string;
  mapCenter: GeoPoint | null;
  /** Epoch ms the request was received: the deadline counts from here, cold start included. */
  receivedAt: number;
}

const LIMIT_TEXT =
  'This turn reached its time or output limit before the answer was complete. The records found so far are listed below; ask again, or narrow the question.';
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** A model failure for the log: its name, HTTP status and message, cut to 300 characters. */
export function describeModelError(error: unknown): string {
  const details = error as { name?: unknown; statusCode?: unknown; message?: unknown } | null;
  const name = typeof details?.name === 'string' ? details.name : 'Error';
  const status = typeof details?.statusCode === 'number' ? ` ${String(details.statusCode)}` : '';
  const message = typeof details?.message === 'string' ? `: ${details.message}` : '';
  return `${name}${status}${message}`.slice(0, 300);
}

function hasCause(error: unknown, type: new (...args: never[]) => Error): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof type) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * One agent turn (docs/decisions.md §6; the pipeline agent's turn, with the CRM's tools): a
 * `ToolLoopAgent` on the cached Bedrock model inside the turn's budget, then the server's checks.
 * Evidence comes from tool results; the answer is sanitized and every id it cites must be one a tool
 * returned in this turn, or no model text is returned at all (`tool_error`). The deadline or the
 * output budget ends the turn with `limit_reached` and the evidence found so far.
 */
export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnResult> {
  const now = deps.now ?? Date.now;
  const limits = { ...TURN_LIMITS, ...deps.limits };
  const { meta } = deps;
  const deadline = input.receivedAt + limits.deadlineMs;
  const budget = new TurnBudget({
    deadlineAt: deadline - limits.reserveMs,
    maxOutputTokens: limits.maxOutputTokens,
    stepOutputTokens: limits.stepOutputTokens,
    now,
  });
  const question = input.messages.at(-1)?.content ?? '';
  // `failure` is set below when the model call throws; the stats read it.
  const evidence = new EvidenceCollector(meta.run.run_id);
  const guard = new CoordinateGuard(
    input.messages.filter((message) => message.role === 'user').map((message) => message.content),
    input.mapCenter,
  );
  const { tools, records, used, leadsCreated, notes } = buildTurnTools({
    pipeline: deps.pipeline,
    leads: deps.leads,
    workspaceId: input.workspaceId,
    meta,
    evidence,
    guard,
    saveRequested: asksToSaveLeads(input.messages),
    remainingMs: () => budget.remainingMs(),
    log: deps.logToolCall ?? (() => undefined),
  });
  const session = input.sessionId ?? input.requestId;
  const Agent = deps.langsmith.ToolLoopAgent;
  const agent = new Agent({
    model: budget.wrap(deps.model),
    // Two system messages: the run prompt (the same for every turn of a run, so it carries the cache
    // point) and the pin line, which changes with every pin (alakazam F5 review item 10).
    instructions: [
      { role: 'system', content: systemPrompt(meta) },
      { role: 'system', content: pinInstruction(input.mapCenter) },
    ],
    tools,
    stopWhen: isStepCount(limits.maxSteps),
    maxRetries: 0,
    providerOptions: {
      langsmith: deps.langsmith.providerOptions({
        session_id: session,
        thread_id: session,
        request_id: input.requestId,
        bedrock_model_id: deps.modelId,
        ls_provider: 'amazon_bedrock',
        ls_model_name: deps.modelId,
        prompt_version: PROMPT_VERSION,
        ...BEDROCK_PROMPT_CACHE_METADATA,
      }),
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(
    () => {
      controller.abort();
    },
    Math.max(0, deadline - limits.reserveMs - now()),
  );
  const messages: ModelMessage[] = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  let text = '';
  let finishReason = 'other';
  let stoppedBy: 'deadline' | 'output_budget' | 'steps' | null = null;
  let failure: unknown = null;
  try {
    const result = await agent.generate({ messages, abortSignal: controller.signal });
    text = result.text;
    finishReason = result.finishReason;
    const last = result.steps.at(-1);
    if ((last?.toolCalls.length ?? 0) > 0 && result.steps.length >= limits.maxSteps) {
      stoppedBy = 'steps';
    }
  } catch (error) {
    if (
      error instanceof DeadlineError ||
      hasCause(error, DeadlineError) ||
      controller.signal.aborted ||
      budget.remainingMs() <= 0
    ) {
      stoppedBy = 'deadline';
    } else if (error instanceof OutputBudgetError || hasCause(error, OutputBudgetError)) {
      stoppedBy = 'output_budget';
    } else {
      failure = error;
    }
  } finally {
    clearTimeout(timer);
  }

  const totals = budget.totals();
  const modelError = failure === null ? null : describeModelError(failure);
  const stats = (
    outcome: ChatOutcome,
    answer: string | null,
    cited = 0,
    citationReasons: string[] = [],
  ): TurnStats => ({
    outcome,
    steps: totals.steps,
    tool_calls: records.length,
    tool_errors: records.filter((record) => record.status !== 'ok').length,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_read_tokens: totals.cacheReadTokens,
    cache_write_tokens: totals.cacheWriteTokens,
    model_ms: totals.modelMs,
    turn_ms: now() - input.receivedAt,
    deadline_hit: stoppedBy === 'deadline',
    citation_failures: citationReasons.length,
    bedrock_throttles: budget.throttles,
    retries: budget.retries,
    evidence: evidence.items.length,
    cited,
    leads_created: leadsCreated.length,
    question_sha256: sha(question),
    answer_sha256: answer ? sha(answer) : null,
    model_error: modelError,
    citation_failure_reasons: citationReasons.slice(0, 3),
  });

  let bedrockFailure: BedrockFailure | null = null;
  if (failure) {
    bedrockFailure = classifyBedrockError(failure);
    if (bedrockFailure === 'denied')
      return { kind: 'model_unavailable', stats: stats('tool_error', null) };
  }
  if (budget.modelTimeouts > 0 && !bedrockFailure) bedrockFailure = 'server_error';

  const assumptions = [...notes, ...turnAssumptions(evidence, used, input.mapCenter)];
  const respond = (
    outcome: ChatOutcome,
    answer: string,
    modelAssumptions: string[],
    cited = 0,
    citationReasons: string[] = [],
  ): TurnResult => ({
    kind: 'response',
    bedrockFailure,
    stats: stats(outcome, answer || null, cited, citationReasons),
    body: {
      outcome,
      answer,
      assumptions: [...modelAssumptions, ...assumptions],
      tool_calls: records.map((record) => ({
        id: record.id,
        name: record.name,
        args: record.args,
        status: record.status,
        total: record.total,
        returned: record.returned,
        result_summary: record.result_summary,
      })),
      evidence: evidence.items,
      limitations: turnLimitations(meta, evidence),
      center_used: centerUsed(used, input.mapCenter),
      leads_created: leadsCreated,
      run_id: meta.run.run_id,
      model_id: deps.modelId,
      prompt_version: PROMPT_VERSION,
      request_id: input.requestId,
    },
  });

  if (stoppedBy) return respond('limit_reached', LIMIT_TEXT, []);
  // A failed model call returns no model text at all.
  if (failure) return respond('tool_error', '', []);

  const parsed = parseFinalMessage(text);
  let answer = sanitizeAnswer(parsed.answer);
  const modelAssumptions = parsed.assumptions.map(sanitizeAnswer).filter((line) => line);
  if (finishReason === 'length' && answer) answer = `${answer} …`;
  if (!answer) return respond('tool_error', '', []);
  // The model's assumption lines are model text too: checked with the answer.
  const check = checkCitations([...modelAssumptions, answer].join('\n'), evidence);
  if (!check.ok) {
    return respond(
      'tool_error',
      '',
      [],
      0,
      check.failures.map((item) => item.reason),
    );
  }
  const okCalls = records.filter((record) => record.status === 'ok').length;
  const asks = check.cited.length === 0 && answer.includes('?');
  let outcome: ChatOutcome =
    parsed.outcome ??
    (asks ? 'needs_clarification' : okCalls > 0 ? 'answered' : 'needs_clarification');
  // Reporting on the data requires at least one successful tool call.
  if ((outcome === 'answered' || outcome === 'no_matches') && okCalls === 0) {
    return respond('tool_error', '', []);
  }
  if (outcome === 'answered' && check.cited.length === 0 && evidence.items.length === 0) {
    outcome = 'no_matches';
  }
  return respond(outcome, answer, modelAssumptions, check.cited.length);
}
