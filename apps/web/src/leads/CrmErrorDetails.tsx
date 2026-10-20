import type { CrmApiFailure } from '@roofing-crm/api-client';

/**
 * A failed CRM API call: what happened, and the request ids that find it in the logs, the CRM's
 * and, when a pipeline call was the cause, the pipeline's (docs/decisions.md §4).
 */
export function CrmErrorDetails({ failure }: { failure: CrmApiFailure }) {
  return (
    <>
      <p>{failure.message}</p>
      <p>
        Request id{' '}
        {failure.requestId ? (
          <code>{failure.requestId}</code>
        ) : (
          'none (no response reached the browser)'
        )}
        {failure.failure?.pipeline_request_id ? (
          <>
            {' '}
            · pipeline request id <code>{failure.failure.pipeline_request_id}</code>
          </>
        ) : null}
      </p>
    </>
  );
}
