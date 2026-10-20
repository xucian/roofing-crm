import type { Logger } from '@aws-lambda-powertools/logger';
import type { LeadService } from './leads/service';
import type { RequestMetrics } from './observability';

/** What each procedure gets: the request's id, its lead service and its metrics. */
export interface Context {
  requestId: string;
  leads: LeadService;
  metrics: RequestMetrics;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}
