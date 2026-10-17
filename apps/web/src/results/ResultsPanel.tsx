import type { RuntimeConfig } from '../config/runtime-config';
import { Callout } from '../app/Callout';

/**
 * The browsable list of matching roofs (README AC 7). Its rows, the "N matches, showing M" summary
 * and the markers are typed by the client generated from the pipeline's pinned openapi.json; until
 * that file exists (pipeline T7) this panel says so instead of showing invented rows.
 */
export function ResultsPanel({ config }: { config: RuntimeConfig }) {
  return (
    <section className="panel-section" aria-labelledby="results-heading">
      <h2 id="results-heading" className="panel-heading">
        Matching roofs
      </h2>
      {config.pipelineApiBase === null ? (
        <Callout tone="warning" title="Pipeline API not configured">
          This deployment has no pipeline API base in /config.json, so no properties can be
          searched. Deploy with PIPELINE_API_BASE set (docs/runbook.md).
        </Callout>
      ) : (
        <Callout tone="info" title="Waiting for the pipeline contract">
          Matches are listed here once the client is generated from the pipeline&apos;s pinned
          openapi.json.
        </Callout>
      )}
    </section>
  );
}
