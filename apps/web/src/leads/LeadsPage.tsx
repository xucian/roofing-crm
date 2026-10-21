import type { CrmApiFailure } from '@roofing-crm/api-client';
import {
  LEAD_LIST_PAGE,
  LEAD_NOTE_MAX,
  LEAD_STATUSES,
  formatCount,
  matchesLeadFilter,
  type GeoPoint,
  type Lead,
  type LeadFilter,
  type LeadStatus,
} from '@roofing-crm/shared';
import { useId, useState } from 'react';
import { Callout } from '../app/Callout';
import { CrmErrorDetails } from './CrmErrorDetails';
import { LeadFilters } from './LeadFilters';
import type { LeadFilterDraft } from './lead-filter';
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
import { MAX_LIST_PAGES, type EditOutcome, type LeadsStore } from './use-leads';

export interface LeadsPageFilters {
  draft: LeadFilterDraft;
  onChange: (draft: LeadFilterDraft) => void;
  /** The filter the draft makes, null when it filters nothing. */
  active: LeadFilter | null;
  center: GeoPoint;
  mapRadiusMiles: number;
}

export interface LeadsPageProps {
  leads: LeadsStore;
  filters: LeadsPageFilters;
  /** Centers the map on the lead and opens its property, without reloading the page. */
  onShowOnMap: (lead: Lead) => void;
}

/**
 * The Leads page (README AC 8; docs/decisions.md §5, §7): every lead saved in this browser's
 * workspace, newest first, read back from the CRM API so it survives a reload. Each lead shows the
 * snapshot taken when it was saved, labelled as one, and can be given a status and a note, or
 * deleted. The filters narrow the list through the `leads` function.
 */
export function LeadsPage({ leads, filters, onShowOnMap }: LeadsPageProps) {
  const { view, workspace, filtered, notice } = leads;
  const shown =
    filtered.status === 'ready'
      ? filtered.leads
      : filtered.status === 'off' && view.status === 'ready'
        ? view.leads
        : null;
  // The filter the shown list answered; an edited lead it no longer keeps stays until it changes.
  const answered = filtered.status === 'ready' ? filtered.filter : null;
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
      {notice ? (
        <Callout tone="info" onDismiss={leads.dismissNotice}>
          <p>{notice.text}</p>
          {notice.requestId ? (
            <p>
              Request id <code>{notice.requestId}</code>
            </p>
          ) : null}
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
            <>
              <LeadFilters
                draft={filters.draft}
                onChange={filters.onChange}
                center={filters.center}
                mapRadiusMiles={filters.mapRadiusMiles}
                active={filters.active !== null}
              />
              <FilterSummary
                leads={leads}
                total={view.leads.length}
                shown={shown?.length ?? null}
              />
              {shown && shown.length > 0 ? (
                <ol className="leads-list">
                  {shown.map((lead) => (
                    <LeadCard
                      key={lead.lead_id}
                      lead={lead}
                      leads={leads}
                      outsideFilter={answered !== null && !matchesLeadFilter(lead, answered)}
                      onShowOnMap={onShowOnMap}
                    />
                  ))}
                </ol>
              ) : null}
            </>
          )}
          {view.truncated ? (
            <p className="field-hint">
              Showing the first {formatCount(MAX_LIST_PAGES * LEAD_LIST_PAGE.max)} leads of this
              workspace.
            </p>
          ) : null}
          {filtered.status === 'off' && view.requestId ? (
            <p className="results-request">
              Request id <code>{view.requestId}</code>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** "3 of 9 leads match the filters", the filtered read's request id, or why it failed. */
function FilterSummary({
  leads,
  total,
  shown,
}: {
  leads: LeadsStore;
  total: number;
  shown: number | null;
}) {
  const { filtered } = leads;
  if (filtered.status === 'off') return null;
  if (filtered.status === 'failed') {
    return (
      <Callout tone="error" title="The filtered leads could not be loaded">
        <CrmErrorDetails failure={filtered.error} />
        <button
          type="button"
          className="button button--quiet callout-action"
          onClick={leads.reloadFiltered}
        >
          Try again
        </button>
      </Callout>
    );
  }
  if (filtered.status === 'loading') {
    return (
      <p className="field-hint" aria-live="polite">
        Filtering leads…
      </p>
    );
  }
  return (
    <div className="leads-filter-summary" aria-live="polite">
      <p>
        <strong>
          {formatCount(shown ?? 0)} of {formatCount(total)}
        </strong>{' '}
        {total === 1 ? 'lead matches' : 'leads match'} the filters.
        {shown === 0 ? ' Loosen a filter or clear them to see the others.' : null}
      </p>
      {filtered.truncated ? (
        <p className="field-hint">
          Showing the first {formatCount(MAX_LIST_PAGES * LEAD_LIST_PAGE.max)} matches.
        </p>
      ) : null}
      {filtered.requestId ? (
        <p className="results-request">
          Request id <code>{filtered.requestId}</code>
        </p>
      ) : null}
    </div>
  );
}

type CardState =
  | { kind: 'idle' }
  | { kind: 'busy'; action: 'status' | 'note' | 'delete' }
  | { kind: 'done'; text: string; requestId: string }
  | { kind: 'failed'; error: CrmApiFailure };

function LeadCard({
  lead,
  leads,
  outsideFilter,
  onShowOnMap,
}: {
  lead: Lead;
  leads: LeadsStore;
  outsideFilter: boolean;
  onShowOnMap: (lead: Lead) => void;
}) {
  const { snapshot } = lead;
  const permit = snapshot.permit;
  const basis = formatRoofBasis(snapshot);
  const duration = permit ? formatSnapshotDuration(permit) : null;
  const bbb = permit ? formatSnapshotBbb(permit) : null;
  const href = leadMapLink(lead);
  const address = formatLeadAddress(lead);
  const noteId = useId();
  const [state, setState] = useState<CardState>({ kind: 'idle' });
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const busy = state.kind === 'busy';

  const settle = (outcome: EditOutcome, text: string): boolean => {
    setState(
      outcome.ok
        ? { kind: 'done', text, requestId: outcome.requestId }
        : { kind: 'failed', error: outcome.error },
    );
    return outcome.ok;
  };
  const setStatus = async (status: LeadStatus): Promise<void> => {
    setState({ kind: 'busy', action: 'status' });
    settle(await leads.update(lead, { status }), `Status set to ${LEAD_STATUS_LABELS[status]}.`);
  };
  const saveNote = async (note: string): Promise<void> => {
    setState({ kind: 'busy', action: 'note' });
    if (settle(await leads.update(lead, { note }), note === '' ? 'Note removed.' : 'Note saved.')) {
      setNoteDraft(null);
    }
  };
  const remove = async (): Promise<void> => {
    setState({ kind: 'busy', action: 'delete' });
    const outcome = await leads.remove(lead);
    // On success the card leaves the list and the page reports the delete.
    if (!outcome.ok) {
      setConfirming(false);
      setState({ kind: 'failed', error: outcome.error });
    }
  };

  return (
    <li className="lead-card" aria-label={address}>
      <div className="lead-head">
        <span className="lead-address">{address}</span>
        <select
          className={`lead-status lead-status--${lead.status}`}
          aria-label={`Status of ${address}`}
          value={lead.status}
          disabled={busy}
          onChange={(event) => {
            void setStatus(event.target.value as LeadStatus);
          }}
        >
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LEAD_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
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

      {noteDraft !== null ? (
        <form
          className="lead-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNote(noteDraft);
          }}
        >
          <label className="field-label" htmlFor={noteId}>
            Note
          </label>
          <textarea
            id={noteId}
            className="lead-note-input"
            rows={3}
            maxLength={LEAD_NOTE_MAX}
            value={noteDraft}
            disabled={busy}
            onChange={(event) => {
              setNoteDraft(event.target.value);
            }}
          />
          <p className="field-hint">
            {formatCount(noteDraft.length)} of {formatCount(LEAD_NOTE_MAX)} characters. Saved in
            this workspace, never in the logs.
          </p>
          <p className="lead-actions">
            <button type="submit" className="button button--small" disabled={busy}>
              {state.kind === 'busy' && state.action === 'note' ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              className="button button--quiet button--small"
              disabled={busy}
              onClick={() => {
                setNoteDraft(null);
              }}
            >
              Cancel
            </button>
          </p>
        </form>
      ) : lead.note !== '' ? (
        <p className="lead-note">{lead.note}</p>
      ) : null}

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
        {noteDraft === null ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              setNoteDraft(lead.note);
              setConfirming(false);
            }}
          >
            {lead.note === '' ? 'Add a note' : 'Edit note'}
          </button>
        ) : null}
        {confirming ? (
          <span
            className="lead-confirm"
            role="group"
            aria-label={`Delete the lead for ${address}?`}
          >
            Delete this lead and its note?
            <button
              type="button"
              className="button button--danger"
              disabled={busy}
              onClick={() => {
                void remove();
              }}
            >
              {state.kind === 'busy' && state.action === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete…
          </button>
        )}
      </p>

      {state.kind === 'busy' && state.action === 'status' ? (
        <p className="field-hint" aria-live="polite">
          Saving the status…
        </p>
      ) : null}
      {state.kind === 'done' ? (
        <p className="lead-result" aria-live="polite">
          {state.text} Request id <code>{state.requestId}</code>
        </p>
      ) : null}
      {state.kind === 'failed' ? (
        <div className="lead-result lead-result--failed" role="alert">
          <CrmErrorDetails failure={state.error} />
        </div>
      ) : null}
      {outsideFilter ? (
        <p className="field-hint">
          No longer matches the filters; it leaves the list when they change.
        </p>
      ) : null}
    </li>
  );
}
