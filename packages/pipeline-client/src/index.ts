// Transport and errors of the pipeline API v1 client. They follow the contract's Transport section
// and need no schema. The typed operations are generated from the pinned openapi.json
// (openapi.pin.json); until the pipeline's T7 commits that file, the pin is pending and no
// operation types exist here: none are written by hand.
export {
  PipelineError,
  describePipelineError,
  isPipelineError,
  isStaleCursor,
  parseErrorEnvelope,
} from './errors';
export type { ErrorEnvelope, PipelineErrorInit, PipelineErrorKind } from './errors';
export { readRequestId } from './request-id';
export {
  BROWSER_TIMEOUT_MS,
  LAMBDA_TIMEOUT_MS,
  SERVER_RETRY_MAX_DELAY_MS,
  THROTTLE_BACKOFF_MS,
  createPipelineFetch,
  sleep,
} from './transport';
export type {
  PipelineFetch,
  PipelineFetchOptions,
  RetryEvent,
  RetryReason,
  Sleep,
} from './transport';
