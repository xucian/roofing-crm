import { formatCount } from '@roofing-crm/shared';
import { Callout } from '../app/Callout';
import { CrmErrorDetails } from './CrmErrorDetails';
import type { LeadsStore, SaveReport as Report } from './use-leads';

const FAILURE_HINTS = {
  not_found: 'not in the pipeline',
  mismatch: 'the permit is on another property',
  pipeline: 'the pipeline failed',
  deadline: 'out of time, nothing saved',
} as const;

const plural = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * What the last save did: how many rows were saved, how many were already leads, and each row that
 * failed with why and the request ids (the CRM's, and the pipeline's when it was the cause).
 */
export function SaveReport({
  report,
  leads,
  onShowLeads,
}: {
  report: Report;
  leads: LeadsStore;
  onShowLeads: () => void;
}) {
  if (report.error) {
    return (
      <Callout tone="error" title="Saving failed" onDismiss={leads.dismissSave}>
        <CrmErrorDetails failure={report.error} />
        <button
          type="button"
          className="button button--quiet callout-action"
          onClick={() => {
            leads.save(report.targets, report.origin);
          }}
        >
          Try again
        </button>
      </Callout>
    );
  }

  const parts = [
    report.created.length > 0 ? `Saved ${plural(report.created.length, 'lead', 'leads')}.` : null,
    report.existing.length > 0
      ? `${plural(report.existing.length, 'was', 'were')} already saved.`
      : null,
    report.failed.length > 0 ? `${plural(report.failed.length, 'row', 'rows')} failed.` : null,
  ].filter(Boolean);

  return (
    <Callout
      tone={report.failed.length > 0 ? 'warning' : 'info'}
      title={report.failed.length > 0 ? 'Some rows were not saved' : undefined}
      onDismiss={leads.dismissSave}
    >
      <p>
        {parts.join(' ')}{' '}
        {report.created.length + report.existing.length > 0 ? (
          <button type="button" className="link-button" onClick={onShowLeads}>
            Show leads
          </button>
        ) : null}
      </p>
      {report.failed.length > 0 ? (
        <>
          <ul className="save-failures">
            {report.failed.map(({ target, failure }) => (
              <li key={`${target.property_id}#${target.permit_id}`}>
                {target.label}: {FAILURE_HINTS[failure.code]}. {failure.message}
                {failure.pipeline_request_id ? (
                  <>
                    {' '}
                    Pipeline request id <code>{failure.pipeline_request_id}</code>.
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button--quiet callout-action"
            onClick={() => {
              leads.save(
                report.failed.map(({ target }) => target),
                report.origin,
              );
            }}
          >
            Try the failed {report.failed.length === 1 ? 'row' : 'rows'} again
          </button>
        </>
      ) : null}
      {report.requestId ? (
        <p className="results-request">
          Request id <code>{report.requestId}</code>
        </p>
      ) : null}
    </Callout>
  );
}
