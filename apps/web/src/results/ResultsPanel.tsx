import type { PropertySummary, RetryEvent } from '@roofing-crm/pipeline-client';
import { CREATE_MANY_MAX, formatCount, formatMatchSummary, leadKey } from '@roofing-crm/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout } from '../app/Callout';
import { SaveReport } from '../leads/SaveReport';
import { propertyTarget } from '../leads/targets';
import type { LeadTarget, LeadsStore } from '../leads/use-leads';
import { ErrorDetails } from '../app/ErrorDetails';
import { PipelineWait } from '../app/PipelineWait';
import { describeRetry } from '../pipeline/connection';
import { PropertyRow, type RowLeadControls } from './PropertyRow';
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
  /** Saving rows as leads; null when the CRM API is not available. */
  leads: LeadsStore | null;
  onShowLeads: () => void;
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
  leads,
  onShowLeads,
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
          leads={leads}
          onShowLeads={onShowLeads}
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
  leads,
  onShowLeads,
}: ResultsPanelProps & { search: PropertySearch }) {
  const { view, state, loadMore, retry: searchAgain } = search;
  const [ticked, setTicked] = useState<ReadonlyMap<string, LeadTarget>>(new Map());
  const reportRef = useRef<HTMLDivElement>(null);
  // A save from an answer's Save button reports under that answer, not here.
  const report = leads?.lastSave?.origin === 'map' ? leads.lastSave : null;
  const reportId = report?.id;

  // A save started far down the list reports at the top of the panel: bring it into view, so a row
  // that failed is not missed.
  useEffect(() => {
    if (reportId !== undefined) reportRef.current?.scrollIntoView({ block: 'nearest' });
  }, [reportId]);

  // Only the ticked rows still listed count: a new search leaves the old ticks behind.
  const listed = view.kind === 'ready' ? view.results.items : null;
  const selection = useMemo(() => {
    if (!listed) return [];
    return listed
      .filter((property) => ticked.has(property.property_id))
      .map((property) => propertyTarget(property))
      .filter((target) => !leads?.savedKeys.has(leadKey(target)));
  }, [listed, ticked, leads?.savedKeys]);

  const controls = (property: PropertySummary): RowLeadControls | null => {
    if (!leads) return null;
    const target = propertyTarget(property);
    const key = leadKey(target);
    const checked = selection.some((row) => row.property_id === property.property_id);
    return {
      checked,
      canCheck: selection.length < CREATE_MANY_MAX,
      onCheck: (next) => {
        setTicked((current) => {
          const updated = new Map(current);
          if (next) updated.set(property.property_id, target);
          else updated.delete(property.property_id);
          return updated;
        });
      },
      saved: leads.savedKeys.has(key),
      saving: leads.savingKeys.has(key),
      onSave: () => {
        leads.save([target]);
      },
    };
  };

  return (
    <>
      <div ref={reportRef} className="save-report-anchor">
        {leads && report ? (
          <SaveReport key={report.id} report={report} leads={leads} onShowLeads={onShowLeads} />
        ) : null}
      </div>
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
                controls={() => null}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {view.kind === 'ready' ? (
        <>
          {leads && view.results.items.length > 0 ? (
            <SelectionBar
              count={selection.length}
              onSave={() => {
                leads.save(selection);
                setTicked(new Map());
              }}
              onClear={() => {
                setTicked(new Map());
              }}
            />
          ) : null}
          <ResultsList
            results={view.results}
            roofAgeMin={roofAgeMin}
            openPermits={openPermits}
            selectedId={selectedId}
            onSelect={onSelect}
            controls={controls}
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
  controls,
}: {
  results: SearchResults;
  roofAgeMin: number;
  openPermits: boolean;
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
  controls: (property: PropertySummary) => RowLeadControls | null;
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
            lead={controls(property)}
          />
        ))}
      </ol>
    </>
  );
}

/** Ticked rows are saved together, at most 25 per save (one pipeline call per row). */
function SelectionBar({
  count,
  onSave,
  onClear,
}: {
  count: number;
  onSave: () => void;
  onClear: () => void;
}) {
  if (count === 0) {
    return (
      <p className="field-hint">
        Tick rows to save several as leads at once (up to {String(CREATE_MANY_MAX)}).
      </p>
    );
  }
  return (
    <div className="selection-bar" role="group" aria-label="Selected rows">
      <span>
        {formatCount(count)} selected
        {count >= CREATE_MANY_MAX ? ` (the most one save takes)` : null}
      </span>
      <button type="button" className="button button--small" onClick={onSave}>
        Save {formatCount(count)} as {count === 1 ? 'a lead' : 'leads'}
      </button>
      <button type="button" className="button button--quiet button--small" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

function emptyHint(roofAgeMin: number, openPermits: boolean): string {
  if (roofAgeMin === 0) return 'No property in this radius. Widen the radius.';
  const aged = `No roof in this radius is older than ${String(roofAgeMin)} years`;
  return openPermits
    ? `${aged}, and none has an open or stalled roofing permit. Widen the radius or lower the threshold.`
    : `${aged}. Widen the radius, lower the threshold or turn on open permits.`;
}
