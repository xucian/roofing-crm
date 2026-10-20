import type { PermitSummary } from '@roofing-crm/pipeline-client';
import {
  ROOF_WORK_CLASS_LABELS,
  STATUS_GROUP_HINTS,
  STATUS_GROUP_LABELS,
  contractorLines,
  formatBbb,
  formatOpenDuration,
  formatPropertyLink,
  isLongOpen,
  permitDates,
} from './format-permit';
import { Provenance } from './Provenance';

/**
 * One permit (README AC 6): its status, how long it has been or was open, the work, the contractor
 * as printed with its BBB status, and where each field comes from. Third-party text is rendered as
 * text only.
 */
export function PermitCard({ permit }: { permit: PermitSummary }) {
  const duration = formatOpenDuration(permit);
  const dates = permitDates(permit);
  const longOpen = isLongOpen(permit);
  return (
    <li className={`permit permit--${permit.status_group}${longOpen ? ' permit--long-open' : ''}`}>
      <div className="permit-head">
        <span className="permit-id">{permit.permit_id}</span>
        <span
          className={`status status--${permit.status_group}`}
          title={STATUS_GROUP_HINTS[permit.status_group]}
        >
          {STATUS_GROUP_LABELS[permit.status_group]}
        </span>
        {longOpen ? <span className="status status--long-open">Long-open</span> : null}
      </div>
      {duration ? <p className="permit-duration">{duration}</p> : null}
      <p className="permit-work">
        {ROOF_WORK_CLASS_LABELS[permit.roof_work_class]} · printed status “{permit.status}”
        {permit.status_source === 'indexed'
          ? `, as of ${permit.status_observed_at.slice(0, 10)}`
          : ''}
      </p>
      {permit.description.trim() !== '' ? (
        <p className="permit-description">{permit.description}</p>
      ) : null}
      {dates.length > 0 ? (
        <p className="permit-meta">
          {dates.map((date) => `${date.label} ${date.value}`).join(' · ')}
        </p>
      ) : null}

      <div className="permit-contractor">
        <p className="permit-subheading">Contractor</p>
        {permit.contractor ? (
          <>
            <dl className="detail-fields">
              {contractorLines(permit.contractor).map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
              <div>
                <dt>BBB</dt>
                <dd title={permit.bbb.note ?? undefined}>{formatBbb(permit.bbb)}</dd>
              </div>
            </dl>
            <p className="permit-meta">
              As printed on the permit: an attribution, not a verified identity.
            </p>
          </>
        ) : (
          <p className="permit-meta">No contractor is printed on this permit.</p>
        )}
      </div>

      <details className="permit-sources">
        <summary>Source and CIDs</summary>
        <p className="permit-meta">
          {permit.permit_type} · {permit.permit_class} · {permit.work_class}.{' '}
          {formatPropertyLink(permit.property_link)}
        </p>
        <Provenance
          source={permit.source}
          cids={{
            record: permit.record_cid,
            property: permit.property_cid,
            dataGroup: permit.data_group_cid,
          }}
          unpublished={permit.unpublished_source}
        />
      </details>
    </li>
  );
}
