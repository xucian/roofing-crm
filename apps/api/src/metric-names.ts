// Names shared by the function (which emits them) and the stack (whose alarms read them). Listed with
// their units and dimensions in docs/metrics.md (metagross items 16 and 17).

export const SERVICE_NAME = 'roofing-crm-api';
export const METRICS_NAMESPACE = 'RoofingCrm';

export const METRIC = {
  /** A lead row created or found existing; dimension `operation`. */
  leadProcessed: 'LeadProcessed',
  /** A lead row that could not be saved; dimensions `operation` and `reason`. */
  leadFailed: 'LeadFailed',
  /** A pipeline call that answered 2xx. */
  pipelineCallProcessed: 'PipelineCallProcessed',
  /** A pipeline call that failed; dimension `status` (see PIPELINE_FAILURE_STATUSES). */
  pipelineCallFailed: 'PipelineCallFailed',
  /** Milliseconds per procedure call; dimension `operation`. */
  processingDuration: 'ProcessingDuration',
} as const;

/** The `status` dimension of PipelineCallFailed. */
export const PIPELINE_FAILURE_STATUSES = [
  '429',
  '4xx',
  '5xx',
  'timeout',
  'network',
  'aborted',
] as const;
export type PipelineFailureStatus = (typeof PIPELINE_FAILURE_STATUSES)[number];

/** Failures that mean the CRM's only data source is unreachable: these raise the alarm. */
export const PIPELINE_OUTAGE_STATUSES: readonly PipelineFailureStatus[] = ['5xx', 'timeout'];
