import { describePipelineError, isPipelineError, type Meta } from '@roofing-crm/pipeline-client';
import { formatCount } from '@roofing-crm/shared';
import type { RuntimeConfig } from '../config/runtime-config';
import type { MetaState } from './use-meta';

/**
 * Data freshness and provenance from the pipeline's /v1/meta (docs/decisions.md §7, 2026-10-17):
 * the run id, the manifest CID, the data group CIDs and Atlas once it is set.
 */
export function Footer({ config, meta }: { config: RuntimeConfig; meta: MetaState }) {
  const build = import.meta.env.VITE_BUILD_COMMIT ?? 'local';
  return (
    <footer className="app-footer">
      <span>
        Data: Travis County pipeline API v1 ·{' '}
        {config.pipelineApiBase ? new URL(config.pipelineApiBase).host : 'not configured'}
      </span>
      {config.pipelineApiBase ? <RunDetails meta={meta} /> : null}
      <span>CRM build {build}</span>
    </footer>
  );
}

function RunDetails({ meta }: { meta: MetaState }) {
  switch (meta.status) {
    case 'waiting':
      return <span className="app-footer-grow">Run details load after the first search.</span>;
    case 'failed':
      return (
        <span className="app-footer-grow">
          Run details unavailable:{' '}
          {isPipelineError(meta.error)
            ? `${describePipelineError(meta.error)}${meta.error.requestId ? ` Request id ${meta.error.requestId}.` : ''}`
            : String(meta.error)}
        </span>
      );
    case 'ready':
      return <Provenance meta={meta.meta} />;
  }
}

function Provenance({ meta }: { meta: Meta }) {
  const groups = Object.entries(meta.groups).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <span>
        Run <code>{meta.run.run_id}</code>
      </span>
      <span title={meta.manifest_cid}>
        Manifest CID <code>{shortCid(meta.manifest_cid)}</code>
      </span>
      <details className="footer-groups">
        <summary>
          {formatCount(groups.length)} data group {groups.length === 1 ? 'CID' : 'CIDs'}
        </summary>
        <dl className="footer-groups-list">
          {groups.map(([name, group]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                <code>{group.cid}</code>
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <span className="app-footer-grow">
        Atlas: {meta.atlas ? atlasText(meta.atlas) : 'not published yet'}
      </span>
    </>
  );
}

function atlasText(atlas: NonNullable<Meta['atlas']>): string {
  const parts = [
    atlas.index_cid ? `index ${shortCid(atlas.index_cid)}` : null,
    atlas.ipns ? `IPNS ${atlas.ipns}` : null,
    atlas.merge_state ? `merge ${atlas.merge_state}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'set, no index yet';
}

/** "bafybeid6jqq…qiup36ud4": the ends of a CID; the full value is in the title. */
function shortCid(cid: string): string {
  return cid.length > 24 ? `${cid.slice(0, 12)}…${cid.slice(-9)}` : cid;
}
