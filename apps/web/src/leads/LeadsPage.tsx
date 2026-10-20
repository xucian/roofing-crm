import { LEAD_LIST_PAGE, formatCount, type Lead } from '@roofing-crm/shared';
import { Callout } from '../app/Callout';
import { CrmErrorDetails } from './CrmErrorDetails';
import { formatRoofAge, formatRoofBasis } from '../results/format-property';
import {
  LEAD_STATUS_LABELS,
  formatLeadAddress,
  formatSnapshotBbb,
  formatSnapshotDuration,
  formatSnapshotPermitBasis,
  formatSnapshotPermitStatus,
  leadMapLink,
} from './format-lead';
import { MAX_LIST_PAGES, type LeadsStore } from './use-leads';

export interface LeadsPageProps {
  leads: LeadsStore;
  /** Centers the map on the lead and opens its property, without reloading the page. */
  onShowOnMap: (lead: Lead) => void;
}

/**
 * The Leads page (README AC 8, creating; docs/decisions.md §7): every lead saved in this browser's
 * workspace, newest first, read back from the CRM API so it survives a reload. Each lead shows the
 * snapshot taken when it was saved, labelled as one. Editing, deleting and filtering arrive in F4.
 */
export function LeadsPage({ leads, onShowOnMap }: LeadsPageProps) {
  const { view, workspace } = leads;
  return (
    <section className="leads-page" aria-labelledby="leads-heading">
      <header className="leads-header">
        <h1 id="leads-heading" className="leads-title">
          Leads
          {view.status === 'ready' ? (
            <span className="leads-count">{formatCount(view.leads.length)}</span>
          ) : null}
        </h1>
        <p className="field-hint">
          Saved in this browser&apos;s workspace <code>{workspace.id}</code>. Anyone with this
          browser sees them; clearing its site data starts a new, empty workspace.
        </p>
        {!workspace.persistent ? (
          <Callout tone="warning" title="This browser does not keep site data">
            Leads saved now are stored, but after a reload this page starts a new workspace and
            cannot list them.
          </Callout>
        ) : null}
      </header>

      {view.status === 'loading' ? (
        <p className="field-hint" aria-live="polite">
          Loading leads…
        </p>
      ) : null}
      {view.status === 'failed' ? (
        <Callout tone="error" title="The leads could not be loaded">
          <CrmErrorDetails failure={view.error} />
          <button
            type="button"
            className="button button--quiet callout-action"
            onClick={leads.reload}
          >
            Try again
          </button>
        </Callout>
      ) : null}
      {view.status === 'ready' ? (
        <>
          {view.leads.length === 0 ? (
            <p className="leads-empty">
              No leads yet. On the map, save a matching roof with <strong>Save lead</strong>, tick
              several rows to save them at once, or save a permit from a property&apos;s details.
            </p>
          ) : (
            <ol className="leads-list">
              {view.leads.map((lead) => (
                <LeadCard key={lead.lead_id} lead={lead} onShowOnMap={onShowOnMap} />
              ))}
            </ol>
          )}
          {view.truncated ? (
            <p className="field-hint">
              Showing the first {formatCount(MAX_LIST_PAGES * LEAD_LIST_PAGE.max)} leads of this
              workspace.
            </p>
          ) : null}
          {view.requestId ? (
            <p className="results-request">
              Request id <code>{view.requestId}</code>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function LeadCard({ lead, onShowOnMap }: { lead: Lead; onShowOnMap: (lead: Lead) => void }) {
  const { snapshot } = lead;
  const permit = snapshot.permit;
  const basis = formatRoofBasis(snapshot);
  const duration = permit ? formatSnapshotDuration(permit) : null;
  const bbb = permit ? formatSnapshotBbb(permit) : null;
  const href = leadMapLink(lead);
  return (
    <li className="lead-card">
      <div className="lead-head">
        <span className="lead-address">{formatLeadAddress(lead)}</span>
        <span className={`lead-status lead-status--${lead.status}`}>
          {LEAD_STATUS_LABELS[lead.status]}
        </span>
      </div>
      <p className="lead-kind">
        {lead.permit_id === '' ? 'Property lead' : `Permit lead · ${lead.permit_id}`} · property{' '}
        {lead.property_id}
      </p>
      <p>
        <strong>{formatRoofAge(snapshot)}</strong>
        {basis ? ` · ${basis}` : null}
      </p>
      {permit ? (
        <div className="lead-permit">
          <p>
            <span className="lead-permit-label">{formatSnapshotPermitBasis(permit)}</span>:{' '}
            {formatSnapshotPermitStatus(permit)}
          </p>
          {duration ? <p className="permit-duration">{duration}</p> : null}
          {permit.contractor_name ? (
            <p className="result-meta">
              Contractor as printed: {permit.contractor_name}
              {bbb ? ` · ${bbb}` : null}
            </p>
          ) : (
            <p className="result-meta">No contractor printed on the permit.</p>
          )}
        </div>
      ) : (
        <p className="result-meta">No open or stalled roofing permit when saved.</p>
      )}
      <p className="result-meta">
        Snapshot of pipeline run <code>{snapshot.run_id}</code>, taken{' '}
        {snapshot.taken_at.slice(0, 16).replace('T', ' ')} UTC. The map shows the current data.
      </p>
      <p className="lead-actions">
        <a
          href={href}
          className="button button--quiet"
          onClick={(event) => {
            // A modified click opens the link itself, e.g. in a new tab.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onShowOnMap(lead);
          }}
        >
          Show on map
        </a>
      </p>
    </li>
  );
}
