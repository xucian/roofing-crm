// The pipeline API v1 client: the contract's Transport section (transport, errors, request ids), the
// one-at-a-time queue the pipeline's account needs, and the operations typed by the pinned
// openapi.json (openapi.pin.json). No operation or schema type is written by hand.
export { createPipelineClient } from './client';
export type {
  Bbb,
  CallOptions,
  MatchReason,
  Meta,
  Owner,
  PermitContractor,
  PermitSearchQuery,
  PermitSearchResponse,
  PermitSummary,
  PipelineAnswer,
  PipelineClient,
  PipelineClientOptions,
  PipelineSchemas,
  PropertyDetail,
  PropertySearchQuery,
  PropertySearchResponse,
  PropertySummary,
  RoofAgeAnchor,
  RoofAgeBasis,
  RoofAgeConfidence,
  RoofWorkClass,
  SearchCenter,
  SearchCentersResponse,
  Source,
  StatusGroup,
  UnpublishedSource,
} from './client';
export {
  PipelineError,
  describePipelineError,
  isPipelineError,
  isStaleCursor,
  parseErrorEnvelope,
} from './errors';
export type { ErrorEnvelope, PipelineErrorInit, PipelineErrorKind } from './errors';
export { readRequestId } from './request-id';
export { serializeFetch } from './serialize';
export {
  BROWSER_TIMEOUT_MS,
  FAST_FAILURE_MS,
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
