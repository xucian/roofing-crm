import { describePipelineError, isPipelineError } from '@roofing-crm/pipeline-client';

/**
 * A failed pipeline call: one sentence, the server's detail as plain text, and the request id that
 * finds it in the pipeline's logs (docs/decisions.md §4: nothing is cached or faked in its place).
 */
export function ErrorDetails({ error }: { error: unknown }) {
  if (!isPipelineError(error)) {
    return <p>{error instanceof Error ? error.message : String(error)}</p>;
  }
  return (
    <>
      <p>{describePipelineError(error)}</p>
      {error.detail ? <p className="error-detail">{error.detail}</p> : null}
      <p>
        Request id{' '}
        {error.requestId ? (
          <code>{error.requestId}</code>
        ) : (
          'none (no response reached the browser)'
        )}
      </p>
    </>
  );
}
