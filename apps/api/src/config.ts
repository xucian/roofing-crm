import { normalizePipelineApiBase } from '@roofing-crm/shared';

/**
 * The agent's daily budget (docs/decisions.md §3): turns and model tokens per UTC day. The stack sets
 * AGENT_DAILY_TURNS and AGENT_DAILY_TOKENS from it, and its usage alarm fires at three quarters of
 * the tokens, so one value drives the caps and the alarm.
 */
export const DAILY_LIMITS = { turns: 500, tokens: 5_000_000 } as const;

/** What the stack hands the `leads` function (apps/api/cdk/lib/leads-api.ts). */
export interface ApiConfig {
  /** The DynamoDB table of leads. */
  leadsTable: string;
  /** The pipeline API v1 base (API_BASE). */
  pipelineApiBase: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const leadsTable = env.LEADS_TABLE;
  const pipelineApiBase = env.PIPELINE_API_BASE;
  if (!leadsTable) throw new Error('LEADS_TABLE is not set');
  if (!pipelineApiBase) throw new Error('PIPELINE_API_BASE is not set');
  return { leadsTable, pipelineApiBase: normalizePipelineApiBase(pipelineApiBase) };
}
