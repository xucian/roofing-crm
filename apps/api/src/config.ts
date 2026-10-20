import { normalizePipelineApiBase } from '@roofing-crm/shared';

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
