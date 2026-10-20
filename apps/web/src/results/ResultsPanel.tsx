import type { RetryEvent } from '@roofing-crm/pipeline-client';
import { formatCount, formatMatchSummary } from '@roofing-crm/shared';
import { Callout } from '../app/Callout';
import { ErrorDetails } from '../app/ErrorDetails';
import { PipelineWait } from '../app/PipelineWait';
import { describeRetry } from '../pipeline/connection';
import { PropertyRow } from './PropertyRow';
import type { SearchResults } from './property-search';
import type { PropertySearch } from './use-property-search';

export interface ResultsPanelProps {
  /** Null when the deployment has no pipeline API. */
  search: PropertySearch | null;
  retry: RetryEvent | null;
  roofAgeMin: number;
  openPermits: boolean;
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
}

/**
 * The browsable list of matching roofs (README AC 7): "N matches, showing M" from the API's exact
 * total, one row per roof, "load more" through `next_cursor`, and the request id of the answer.
 */
export function ResultsPanel({
  search,
  retry,
  roofAgeMin,
  openPermits,
  selectedId,
  onSelect,
}: ResultsPanelProps) {
  return (
    <section className="panel-section" aria-labelledby="results-heading">
      <h2 id="results-heading" className="panel-heading">
        Matching roofs
      </h2>
      {search === null ? (
        <Callout tone="warning" title="Pipeline API not configured">
          This deployment has no pipeline API base in /config.json, so no properties can be
          searched. Deploy with pnpm deploy:aws, which sets it (docs/runbook.md).
        </Callout>
      ) : (
        <Results
          search={search}
          retry={retry}
          roofAgeMin={roofAgeMin}
          openPermits={openPermits}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

function Results({
  search,
  retry,
  roofAgeMin,
  openPermits,
  selectedId,
  onSelect,
}: ResultsPanelProps & { search: PropertySearch }) {
  const { view, state, loadMore, retry: searchAgain } = search;
  return (
    <>
      {retry ? (
        <Callout tone="warning" title="Pipeline busy, retrying">
          {describeRetry(retry)}
        </Callout>
      ) : null}
      {state.restarted && view.kind === 'ready' ? (
        <Callout tone="info">
          The pipeline&apos;s data changed while paging, so the list restarted from the first page.
        </Callout>
      ) : null}

      {view.kind === 'failed' ? (
        <Callout tone="error" title="Search failed">
          <ErrorDetails error={view.error} />
          <button
            type="button"
            className="button button--quiet callout-action"
            onClick={searchAgain}
          >
            Try again
          </button>
        </Callout>
      ) : null}

      {view.kind === 'loading' ? (
        <>
          <PipelineWait
            key={view.startedAt ?? 'waiting'}
            title="Searching the pipeline…"
            what="search"
            started={view.startedAt !== null}
          />
          {view.previous ? (
            <div className="results-stale" aria-hidden="true">
              <ResultsList
                results={view.previous}
                roofAgeMin={roofAgeMin}
                openPermits={openPermits}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {view.kind === 'ready' ? (
        <>
          <ResultsList
            results={view.results}
            roofAgeMin={roofAgeMin}
            openPermits={openPermits}
            selectedId={selectedId}
            onSelect={onSelect}
          />
          {view.results.nextCursor !== null ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={loadMore}
              disabled={state.more.status === 'loading'}
            >
              {state.more.status === 'loading' ? 'Loading more…' : 'Load more'}
            </button>
          ) : null}
          {state.more.status === 'failed' ? (
            <Callout tone="error" title="The next page failed">
              <ErrorDetails error={state.more.error} />
            </Callout>
          ) : null}
          {view.results.requestId ? (
            <p className="results-request">
              Request id <code>{view.results.requestId}</code>
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ResultsList({
  results,
  roofAgeMin,
  openPermits,
  selectedId,
  onSelect,
}: {
  results: SearchResults;
  roofAgeMin: number;
  openPermits: boolean;
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
}) {
  return (
    <>
      <p className="results-summary" aria-live="polite">
        {formatMatchSummary(results.total, results.items.length)}
      </p>
      {results.items.length > results.mapItems.length ? (
        <p className="field-hint">
          The map shows the first {formatCount(results.mapItems.length)}; the list goes on below.
        </p>
      ) : null}
      {results.areaNote !== null ? (
        <Callout tone="info" title="Outside the county">
          The pipeline says this center is {results.areaNote}, so nothing is listed. Move the pin
          into Travis County.
        </Callout>
      ) : results.total === 0 ? (
        <p className="field-hint">{emptyHint(roofAgeMin, openPermits)}</p>
      ) : null}
      <ol className="results-list">
        {results.items.map((property) => (
          <PropertyRow
            key={property.property_id}
            property={property}
            selected={property.property_id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ol>
    </>
  );
}

function emptyHint(roofAgeMin: number, openPermits: boolean): string {
  if (roofAgeMin === 0) return 'No property in this radius. Widen the radius.';
  const aged = `No roof in this radius is older than ${String(roofAgeMin)} years`;
  return openPermits
    ? `${aged}, and none has an open or stalled roofing permit. Widen the radius or lower the threshold.`
    : `${aged}. Widen the radius, lower the threshold or turn on open permits.`;
}
