import type { Logger } from '@aws-lambda-powertools/logger';
import type { AgentService } from './agent/service';
import type { LeadService } from './leads/service';
import type { RequestMetrics } from './observability';

/** What each procedure gets: the request's id, its lead service, the agent and its metrics. */
export interface Context {
  requestId: string;
  leads: LeadService;
  /** The agent, in the `agent` function only (the `leads` function never loads the AI SDK). */
  agent: AgentService | null;
  metrics: RequestMetrics;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}
