import type { Owner, PropertyDetail, PropertySummary } from '@roofing-crm/pipeline-client';
import { formatCount, formatMiles, leadKey } from '@roofing-crm/shared';
import { useEffect, useEffectEvent, useRef } from 'react';
import { Callout } from '../app/Callout';
import { ErrorDetails } from '../app/ErrorDetails';
import { PipelineWait } from '../app/PipelineWait';
import {
  MATCH_REASON_LABELS,
  formatAddress,
  formatRoofAge,
  formatRoofAnchor,
  formatRoofBasis,
} from '../results/format-property';
import { SaveReport } from '../leads/SaveReport';
import type { LeadTarget, LeadsStore } from '../leads/use-leads';
import { groupPermits } from './format-permit';
import { PermitCard } from './PermitCard';
import { Provenance } from './Provenance';
import {
  hasMorePermits,
  listedPermits,
  type PermitPages,
  type PropertyDetailLoader,
} from './use-property-detail';

export interface PropertyDrawerProps {
  loader: PropertyDetailLoader;
  /** The list row of the open property, when it is in the results: its match reasons and distance. */
  summary: PropertySummary | undefined;
  onClose: () => void;
  /** Saving the property or one of its permits as a lead; null without the CRM API. */
  leads: LeadsStore | null;
  onShowLeads: () => void;
}

/**
 * The detail drawer (docs/decisions.md §7, README AC 6): the property with its ids and roof age,
 * every permit with status, open duration, contractor and BBB, the owner's public roll fields, and
 * the sources and CIDs behind them. Owner fields appear here only (§4).
 */
export function PropertyDrawer({
  loader,
  summary,
  onClose,
  leads,
  onShowLeads,
}: PropertyDrawerProps) {
  const { state, retry, loadMorePermits } = loader;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const propertyId = state.status === 'closed' ? null : state.propertyId;

  const close = useEffectEvent(onClose);

  // Opening the drawer, or switching it to another property, moves focus to its heading.
  useEffect(() => {
    if (propertyId !== null) headingRef.current?.focus();
  }, [propertyId]);

  // Escape closes the drawer wherever focus is: after a click on the map or the search panel, focus
  // is no longer inside it. A key another control has already handled is left alone.
  const open = propertyId !== null;
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (state.status === 'closed') return null;
  // The last save is shown here when it was about this property.
  const report = leads?.lastSave;
  const address =
    state.status === 'ready'
      ? formatAddress(state.detail.address)
      : summary
        ? formatAddress(summary.address)
        : `Property ${state.propertyId}`;

  return (
    <aside className="detail-drawer" aria-labelledby="detail-heading">
      <div className="detail-header">
        <h2 id="detail-heading" className="detail-title" tabIndex={-1} ref={headingRef}>
          {address}
        </h2>
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>
      <div className="detail-body">
        {leads && report?.targets.some((target) => target.property_id === state.propertyId) ? (
          <SaveReport key={report.id} report={report} leads={leads} onShowLeads={onShowLeads} />
        ) : null}
        {state.status === 'loading' ? (
          <PipelineWait
            key={state.propertyId}
            title="Loading the property…"
            what="property lookup"
            started
          />
        ) : null}
        {state.status === 'failed' ? (
          <Callout tone="error" title="The property could not be loaded">
            <ErrorDetails error={state.error} />
            <button type="button" className="button button--quiet callout-action" onClick={retry}>
              Try again
            </button>
          </Callout>
        ) : null}
        {state.status === 'ready' ? (
          <Detail
            detail={state.detail}
            requestId={state.requestId}
            pages={state.pages}
            summary={summary?.property_id === state.propertyId ? summary : undefined}
            onMorePermits={loadMorePermits}
            leads={leads}
          />
        ) : null}
      </div>
    </aside>
  );
}

function Detail({
  detail,
  requestId,
  pages,
  summary,
  onMorePermits,
  leads,
}: {
  detail: PropertyDetail;
  requestId: string | undefined;
  pages: PermitPages;
  summary: PropertySummary | undefined;
  onMorePermits: () => void;
  leads: LeadsStore | null;
}) {
  const basis = formatRoofBasis(detail);
  const anchor = formatRoofAnchor(detail.roof_age_anchor);
  const listed = listedPermits(detail, pages);
  const { roofing, other } = groupPermits(listed);
  const counts = detail.roofing_permit_counts;
  const bbbNote = listed.find(
    (permit) => permit.contractor !== null && permit.bbb.status === 'blocked' && permit.bbb.note,
  )?.bbb.note;

  return (
    <>
      <section className="detail-section" aria-label="Property">
        <p className="detail-ids">
          Property <code>{detail.property_id}</code>
          {detail.geo_id ? (
            <>
              {' '}
              · geo id <code>{detail.geo_id}</code>
            </>
          ) : null}
          {summary?.distance_miles !== null && summary?.distance_miles !== undefined
            ? ` · ${formatMiles(summary.distance_miles)} from the center`
            : null}
        </p>
        {summary?.match_reasons && summary.match_reasons.length > 0 ? (
          <ul className="result-reasons" aria-label="Why it matched">
            {summary.match_reasons.map((reason) => (
              <li key={reason} className={`reason reason--${reason}`}>
                {MATCH_REASON_LABELS[reason]}
              </li>
            ))}
          </ul>
        ) : null}
        {leads ? (
          <p className="detail-save">
            <SaveButton
              leads={leads}
              target={{
                property_id: detail.property_id,
                permit_id: '',
                label: formatAddress(detail.address),
              }}
              idle="Save property as lead"
            />
          </p>
        ) : null}
      </section>

      <section className="detail-section" aria-labelledby="detail-roof">
        <h3 id="detail-roof" className="detail-heading">
          Roof
        </h3>
        <p>
          <strong>{formatRoofAge(detail)}</strong>
          {basis ? ` · ${basis}` : null}
        </p>
        <p className="result-meta">
          {detail.roof_age_confidence} confidence · as of {detail.roof_age_as_of}
          {anchor ? ` · anchored on ${anchor}` : null}
          {detail.year_built !== null ? ` · built ${String(detail.year_built)}` : null}
        </p>
        {detail.roof_age_caveats.length > 0 ? (
          <ul className="result-caveats" aria-label="Roof age caveats">
            {detail.roof_age_caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="detail-section" aria-labelledby="detail-permits">
        <h3 id="detail-permits" className="detail-heading">
          Roofing permits
        </h3>
        <p className="result-meta">
          {formatCount(counts.open)} open · {formatCount(counts.stalled)} stalled ·{' '}
          {formatCount(counts.closed)} closed
          {counts.needs_review > 0 ? ` · ${formatCount(counts.needs_review)} need review` : null}
        </p>
        {bbbNote ? <p className="field-hint">BBB: {bbbNote}</p> : null}
        {roofing.length > 0 ? (
          <ol className="permit-list">
            {roofing.map((permit) => (
              <PermitCard
                key={permit.permit_id}
                permit={permit}
                action={
                  leads ? (
                    <SaveButton
                      leads={leads}
                      target={{
                        property_id: detail.property_id,
                        permit_id: permit.permit_id,
                        label: `Permit ${permit.permit_id}`,
                      }}
                      idle="Save permit as lead"
                    />
                  ) : null
                }
              />
            ))}
          </ol>
        ) : (
          <p className="field-hint">No roofing permit is listed for this property.</p>
        )}
        {other.length > 0 ? (
          <details className="detail-other">
            <summary>
              Other permits on this property ({formatCount(other.length)}): trade and non-roofing
              work
            </summary>
            <ol className="permit-list">
              {other.map((permit) => (
                <PermitCard key={permit.permit_id} permit={permit} />
              ))}
            </ol>
          </details>
        ) : null}
        <MorePermits detail={detail} pages={pages} listed={listed.length} onMore={onMorePermits} />
      </section>

      <section className="detail-section" aria-labelledby="detail-owner">
        <h3 id="detail-owner" className="detail-heading">
          Owner (public appraisal roll)
        </h3>
        {detail.owner ? (
          <OwnerFields owner={detail.owner} />
        ) : (
          <p className="field-hint">The roll has no owner record for this property.</p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="detail-sources">
        <h3 id="detail-sources" className="detail-heading">
          Sources and CIDs
        </h3>
        <Provenance
          source={detail.source}
          cids={{
            record: detail.record_cid,
            property: detail.property_cid,
            dataGroup: detail.data_group_cid,
          }}
          unpublished={detail.unpublished_source}
        />
        {requestId ? (
          <p className="results-request">
            Request id <code>{requestId}</code>
          </p>
        ) : null}
      </section>
    </>
  );
}

function MorePermits({
  detail,
  pages,
  listed,
  onMore,
}: {
  detail: PropertyDetail;
  pages: PermitPages;
  listed: number;
  onMore: () => void;
}) {
  const more = hasMorePermits(detail, pages);
  return (
    <>
      {more || pages.searched !== null ? (
        <p className="field-hint">
          Showing {formatCount(listed)} of {formatCount(detail.permits_total)} permits.
        </p>
      ) : null}
      {more ? (
        <button
          type="button"
          className="button button--quiet"
          onClick={onMore}
          disabled={pages.status === 'loading'}
        >
          {pages.status === 'loading' ? 'Loading permits…' : 'Load more permits'}
        </button>
      ) : null}
      {pages.status === 'failed' ? (
        <Callout tone="error" title="More permits could not be loaded">
          <ErrorDetails error={pages.error} />
        </Callout>
      ) : null}
    </>
  );
}

const yesNo = (value: boolean | null): string =>
  value === null ? 'unknown' : value ? 'yes' : 'no';

function formatMailing(address: NonNullable<Owner['mailing_address']>): string | null {
  const place = [address.city, address.state, address.zip].filter(Boolean).join(' ');
  const text = [address.line1, address.line2, place].filter(Boolean).join(', ');
  return text === '' ? null : text;
}

/** The owner's public roll fields (§4): no phone or email exists in the sources, so none is shown. */
function OwnerFields({ owner }: { owner: Owner }) {
  const mailing = owner.mailing_address ? formatMailing(owner.mailing_address) : null;
  return (
    <>
      <dl className="detail-fields">
        <div>
          <dt>Name</dt>
          <dd>{owner.owner_name ?? 'not on the roll'}</dd>
        </div>
        <div>
          <dt>Mailing address</dt>
          <dd>{mailing ?? 'not on the roll'}</dd>
        </div>
        <div>
          <dt>Deed date</dt>
          <dd>{owner.deed_date ?? 'not on the roll'}</dd>
        </div>
        <div>
          <dt>Owner for</dt>
          <dd>
            {owner.owner_tenure_years === null
              ? 'unknown'
              : `${owner.owner_tenure_years.toFixed(1)} years`}
          </dd>
        </div>
        <div>
          <dt>Absentee owner</dt>
          <dd>{yesNo(owner.owner_absentee)}</dd>
        </div>
        <div>
          <dt>Out-of-area owner</dt>
          <dd>{yesNo(owner.owner_out_of_area)}</dd>
        </div>
      </dl>
      <p className="field-hint">The roll has no phone or email for owners, so none is shown.</p>
      <details className="permit-sources">
        <summary>Source</summary>
        <Provenance source={owner.source} unpublished={owner.unpublished_source} />
      </details>
    </>
  );
}

/** Saves one property or permit; shows "Saved as lead" once the workspace has it. */
function SaveButton({
  leads,
  target,
  idle,
}: {
  leads: LeadsStore;
  target: LeadTarget;
  idle: string;
}) {
  const key = leadKey(target);
  if (leads.savedKeys.has(key)) return <span className="saved-badge">Saved as lead</span>;
  const saving = leads.savingKeys.has(key);
  return (
    <button
      type="button"
      className="button button--quiet button--small"
      disabled={saving}
      onClick={() => {
        leads.save([target]);
      }}
    >
      {saving ? 'Saving…' : idle}
    </button>
  );
}
