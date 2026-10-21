import { createHash } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  PipelineError,
  describePipelineError,
  type PipelineClient,
} from '@roofing-crm/pipeline-client';
import type { ChatInputSchema, ChatResponse } from '@roofing-crm/shared';
import type { z } from 'zod';
import { LeadRowFailure, type LeadService } from '../leads/service';
import { METRIC, type ChatFailureReason } from '../metric-names';
import type { RequestMetrics } from '../observability';
import { AgentUnavailable } from './errors';
import type { CircuitBreaker } from './governor';
import {
  PLAIN_FACADE,
  clearHistory,
  registerHistory,
  registerPin,
  type LangSmithFacade,
} from './langsmith';
import type { ToolCallRecord } from './tools';
import { TURN_LIMITS, runTurn, type TurnDeps, type TurnStats } from './turn';
import { utcDay, type DailyUsage } from './usage';

/** The parsed `agent.chat` input. */
export type ChatTurnInput = z.output<typeof ChatInputSchema>;

export interface AgentService {
  chat(input: ChatTurnInput): Promise<ChatResponse>;
}

export interface AgentServiceDeps {
  requestId: string;
  /** Epoch ms API Gateway received the request. */
  receivedAt: number;
  pipeline: PipelineClient;
  leads: LeadService;
  usage: DailyUsage;
  breaker: CircuitBreaker;
  langsmith: () => Promise<LangSmithFacade>;
  model: TurnDeps['model'];
  modelId: string;
  metrics: RequestMetrics;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  limits?: TurnDeps['limits'];
  now?: () => number;
}

/** Bound of each step before the turn (the tracing facade). */
const PRE_TURN_MS = 1500;

async function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<F>(
        (resolve) =>
          (timer = setTimeout(
            () => {
              resolve(fallback);
            },
            Math.max(0, ms),
          )),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Free-text tool parameters are logged as hashes; ids, numbers and flags as given. */
const HASHED_PARAMS = new Set(['q']);
/**
 * A search's point is never logged: it may be the map's pin, i.e. a GPS fix (alakazam F5 review
 * item 6, as F4 keeps it out of "leads listed"). The radius stays.
 */
const POINT_PARAMS = new Set(['lat', 'lon']);
export function logParams(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (POINT_PARAMS.has(key)) {
      out[key] = '[point]';
    } else if (key === 'within' && value && typeof value === 'object') {
      out[key] = logParams(value as Record<string, unknown>);
    } else {
      out[key] =
        HASHED_PARAMS.has(key) && typeof value === 'string'
          ? `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
          : value;
    }
  }
  return out;
}

/**
 * One chat turn of `agent.chat` (docs/decisions.md §6): the circuit breaker and the daily budget, the
 * tracing facade, `/v1/meta` first (it takes the pipeline's cold start), the turn, then one log line
 * and one set of metrics, and the traces flushed inside the deadline. Logs carry ids, counts, hashes
 * and timings, never the user's text (alakazam item 9).
 */
export function createAgentService(deps: AgentServiceDeps): AgentService {
  const now = deps.now ?? Date.now;
  const deadlineAt = deps.receivedAt + (deps.limits?.deadlineMs ?? TURN_LIMITS.deadlineMs);
  const failed = (reason: ChatFailureReason) => {
    deps.metrics.count(METRIC.chatFailed, { reason });
  };

  const record = (stats: TurnStats): void => {
    deps.metrics.count(METRIC.chatTurn, { outcome: stats.outcome });
    deps.metrics.count(METRIC.chatInputTokens, {}, stats.input_tokens);
    deps.metrics.count(METRIC.chatOutputTokens, {}, stats.output_tokens);
    deps.metrics.count(METRIC.chatCacheReadTokens, {}, stats.cache_read_tokens);
    deps.metrics.count(METRIC.chatToolCalls, {}, stats.tool_calls);
    deps.metrics.milliseconds(METRIC.chatTurnLatency, {}, stats.turn_ms);
    if (stats.outcome === 'tool_error') failed('tool_error');
    deps.logger.info('chat turn', { model_id: deps.modelId, ...stats });
  };

  return {
    async chat(input) {
      let settled = false;
      let langsmith: LangSmithFacade = PLAIN_FACADE;
      try {
        if (!deps.breaker.allow()) {
          settled = true;
          deps.metrics.count(METRIC.chatRefused, { reason: 'circuit_open' });
          throw new AgentUnavailable('circuit_open');
        }
        const day = utcDay(new Date(now()));
        if (!(await deps.usage.take(day))) {
          deps.metrics.count(METRIC.chatRefused, { reason: 'budget_exhausted' });
          deps.logger.warn('chat refused', { reason: 'budget_exhausted', day });
          throw new AgentUnavailable('budget_exhausted');
        }
        langsmith = await within(deps.langsmith(), PRE_TURN_MS, PLAIN_FACADE);

        let meta;
        try {
          meta = (await deps.pipeline.getMeta()).data;
        } catch (error) {
          if (!(error instanceof PipelineError)) throw error;
          failed('pipeline');
          throw new LeadRowFailure({
            code: 'pipeline',
            message: describePipelineError(error),
            pipeline_request_id: error.requestId ?? null,
          });
        }

        registerHistory(input.messages.slice(0, -1).map((message) => message.content));
        registerPin(input.map_center ?? null);
        const result = await runTurn(
          {
            model: deps.model,
            modelId: deps.modelId,
            langsmith,
            pipeline: deps.pipeline,
            leads: deps.leads,
            meta,
            now,
            ...(deps.limits ? { limits: deps.limits } : {}),
            logToolCall: (call: ToolCallRecord) => {
              deps.logger.info('chat tool call', {
                tool_call_id: call.id,
                tool: call.name,
                params: logParams(call.args),
                status: call.status,
                total: call.total,
                returned: call.returned,
                ms: call.ms,
              });
            },
          },
          {
            messages: input.messages,
            sessionId: input.session_id,
            requestId: deps.requestId,
            workspaceId: input.workspace_id,
            mapCenter: input.map_center ?? null,
            receivedAt: deps.receivedAt,
          },
        );
        record(result.stats);
        try {
          await deps.usage.addTokens(day, result.stats.input_tokens + result.stats.output_tokens);
        } catch (error) {
          deps.logger.warn('chat usage not counted', { error: (error as Error).name });
        }
        await langsmith.flush(Math.min(2000, deadlineAt - now() - 500));
        settled = true;
        if (result.kind === 'model_unavailable') {
          deps.breaker.success();
          failed('model_unavailable');
          throw new AgentUnavailable('model_unavailable');
        }
        if (result.bedrockFailure && result.bedrockFailure !== 'other') deps.breaker.failure();
        else deps.breaker.success();
        return result.body;
      } catch (error) {
        if (!(error instanceof AgentUnavailable) && !(error instanceof LeadRowFailure)) {
          failed('internal');
          await langsmith.flush(Math.min(500, deadlineAt - now() - 500));
        }
        throw error;
      } finally {
        clearHistory();
        // A turn that ended before reporting success or failure must not leave a probe pinned.
        if (!settled) deps.breaker.release();
      }
    },
  };
}
