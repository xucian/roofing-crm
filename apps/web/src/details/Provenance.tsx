import type { Source, UnpublishedSource } from '@roofing-crm/pipeline-client';
import { safeHttpUrl } from '../results/format-property';

export interface ProvenanceProps {
  source: Source;
  cids?: { record: string; property: string; dataGroup: string } | undefined;
  unpublished: UnpublishedSource | null;
}

/**
 * Where a record comes from (docs/decisions.md 2026-10-17): its source record and CIDs, and,
 * labelled apart, the fields backed by a source export rather than a CID (`unpublished_source`).
 */
export function Provenance({ source, cids, unpublished }: ProvenanceProps) {
  const sourceUrl = safeHttpUrl(source.url);
  const exportUrl = unpublished ? safeHttpUrl(unpublished.url) : null;
  return (
    <dl className="detail-fields detail-fields--provenance">
      <div>
        <dt>Source</dt>
        <dd>
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              {source.dataset}
            </a>
          ) : (
            source.dataset
          )}
          , record {source.record_id}, fetched {source.fetched_at}, run {source.run_id}
        </dd>
      </div>
      {cids ? (
        <div>
          <dt>CIDs</dt>
          <dd>
            record <code>{cids.record}</code> · property <code>{cids.property}</code> · data group{' '}
            <code>{cids.dataGroup}</code>
          </dd>
        </div>
      ) : null}
      {unpublished ? (
        <div>
          <dt>Source-backed, not CID-backed</dt>
          <dd>
            {unpublished.fields.join(', ')} from{' '}
            {exportUrl ? (
              <a href={exportUrl} target="_blank" rel="noopener noreferrer">
                {unpublished.dataset}
              </a>
            ) : (
              unpublished.dataset
            )}{' '}
            ({unpublished.evidence_state.replaceAll('_', ' ')}, row sha256{' '}
            <code>{unpublished.row_sha256.slice(0, 12)}…</code>)
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
