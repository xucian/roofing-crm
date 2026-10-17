import type { RuntimeConfig } from '../config/runtime-config';

/**
 * Data freshness and provenance. The run id, group CIDs and manifest CID come from the pipeline's
 * /v1/meta (docs/decisions.md §7, 2026-10-17); they are wired with the generated client.
 */
export function Footer({ config }: { config: RuntimeConfig }) {
  const build = import.meta.env.VITE_BUILD_COMMIT ?? 'local';
  return (
    <footer className="app-footer">
      <span>
        Data: Travis County pipeline API v1 ·{' '}
        {config.pipelineApiBase ? new URL(config.pipelineApiBase).host : 'not configured'}
      </span>
      <span className="app-footer-pending">
        Run id, group CIDs and manifest CID appear here once the pipeline client is connected.
      </span>
      <span>CRM build {build}</span>
    </footer>
  );
}
