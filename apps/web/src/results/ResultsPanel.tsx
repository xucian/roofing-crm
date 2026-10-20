import type { RetryEvent } from '@roofing-crm/pipeline-client';
import { formatCount, formatMatchSummary } from '@roofing-crm/shared';
import { useEffect, useState } from 'react';
import { Callout } from '../app/Callout';
import { ErrorDetails } from '../app/ErrorDetails';
import { describeRetry } from '../pipeline/connection';
import { PropertyRow } from './PropertyRow';
import type { SearchResults } from './property-search';
import type { PropertySearch } from './use-property-search';

export interface ResultsPanelProps {
  /** Null when the deployment has no pipeline API. */
  search: PropertySearch | null;
  retry: RetryEvent | null;
  roofAgeMin: number;
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
          searched. Deploy with PIPELINE_API_BASE set (docs/runbook.md).
        </Callout>
      ) : (
        <Results
          search={search}
          retry={retry}
          roofAgeMin={roofAgeMin}
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
  selectedId,
  onSelect,
}: ResultsPanelProps & { search: PropertySearch }) {
  const { view, state, loadMore } = search;
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
        </Callout>
      ) : null}

      {view.kind === 'loading' ? (
        <>
          <Searching key={view.startedAt ?? 'waiting'} started={view.startedAt !== null} />
          {view.previous ? (
            <div className="results-stale" aria-hidden="true">
              <ResultsList
                results={view.previous}
                roofAgeMin={roofAgeMin}
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
  selectedId,
  onSelect,
}: {
  results: SearchResults;
  roofAgeMin: number;
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
        <p className="field-hint">
          {roofAgeMin > 0
            ? `No roof in this radius is older than ${String(roofAgeMin)} years. Widen the radius or lower the threshold.`
            : 'No property in this radius. Widen the radius.'}
        </p>
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

/** The loading state: a cold pipeline can take several seconds, so the wait is counted. */
function Searching({ started }: { started: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!started) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [started]);
  return (
    <div className="results-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <p className="results-loading-title">
          Searching the pipeline…{seconds > 0 ? ` ${String(seconds)} s` : null}
        </p>
        {seconds >= 3 ? (
          <p className="field-hint">
            The first search after a quiet spell takes longer while the pipeline wakes up, often
            around 10 seconds.
          </p>
        ) : null}
      </div>
    </div>
  );
}
