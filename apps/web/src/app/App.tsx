import type { PropertySearchResponse } from '@roofing-crm/pipeline-client';
import {
  DEFAULT_CENTER,
  DEFAULT_COUNTY,
  MAP_BOUNDS,
  formatCoordinates,
  isWithinBounds,
  type GeoPoint,
} from '@roofing-crm/shared';
import { useMemo, useRef, useState } from 'react';
import type { RuntimeConfig } from '../config/runtime-config';
import { Legend } from '../map/Legend';
import { MapView } from '../map/MapView';
import { NO_RESULTS, resultFeatures } from '../map/layers';
import { createPipelineConnection, useRetryEvent } from '../pipeline/connection';
import { ResultsPanel } from '../results/ResultsPanel';
import { usePropertySearch } from '../results/use-property-search';
import { PlaceBox } from '../search/PlaceBox';
import { SearchPanel } from '../search/SearchPanel';
import { locate } from '../search/geolocation';
import type { CenterSource, SearchState } from '../search/search-state';
import { useSearchState } from '../search/use-search-state';
import { Callout, type CalloutTone } from './Callout';
import { Footer } from './Footer';
import { Nav } from './Nav';
import { useMeta } from './use-meta';

interface Notice {
  tone: CalloutTone;
  text: string;
}

export function App({ config }: { config: RuntimeConfig }) {
  const [search, dispatch] = useSearchState();
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mapProblem, setMapProblem] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const beforeGps = useRef<{ center: GeoPoint; centerSource: CenterSource } | null>(null);

  const connection = useMemo(
    () => (config.pipelineApiBase ? createPipelineConnection(config.pipelineApiBase) : null),
    [config.pipelineApiBase],
  );
  const client = connection?.client ?? null;
  const retry = useRetryEvent(connection?.retries ?? null);

  // A GPS fix inside the map's box but outside the county: the server's area_note says so, and the
  // search goes back to the center it had (docs/decisions.md §4, 2026-10-17).
  const onAnswer = (data: PropertySearchResponse, answered: SearchState): void => {
    const previous = beforeGps.current;
    if (data.area_note === null || answered.centerSource !== 'gps' || !previous) return;
    beforeGps.current = null;
    dispatch({ type: 'restore', ...previous });
    setNotice({
      tone: 'info',
      text: `Your location (${formatCoordinates(answered.center, 3)}) is ${data.area_note}, so the search stays on ${previous.centerSource === 'default' ? DEFAULT_CENTER.label : 'the previous center'}.`,
    });
  };
  const propertySearch = usePropertySearch(client, search, onAnswer);
  const { view, state } = propertySearch;
  const meta = useMeta(client, state.results !== null || state.failure !== null);

  const shown =
    view.kind === 'ready' ? view.results : view.kind === 'loading' ? view.previous : null;
  const markers = useMemo(() => (shown ? resultFeatures(shown.mapItems) : NO_RESULTS), [shown]);

  // A fix outside the county keeps the current center and says so (docs/decisions.md §4). Outside the
  // map's extent is decided here; the server's area_note decides the margin inside it.
  const locateUser = async (): Promise<void> => {
    setLocating(true);
    setNotice(null);
    const outcome = await locate();
    setLocating(false);
    if (outcome.kind === 'failed') {
      setNotice({ tone: 'warning', text: outcome.message });
      return;
    }
    if (!isWithinBounds(outcome.point, MAP_BOUNDS)) {
      const kept = search.centerSource === 'default' ? DEFAULT_CENTER.label : 'the current center';
      setNotice({
        tone: 'info',
        text: `Your location (${formatCoordinates(outcome.point, 3)}) is outside ${DEFAULT_COUNTY.label}, so the search stays on ${kept}.`,
      });
      return;
    }
    if (search.centerSource !== 'gps') {
      beforeGps.current = { center: search.center, centerSource: search.centerSource };
    }
    dispatch({ type: 'gps', point: outcome.point });
  };

  const selectRow = (propertyId: string): void => {
    setSelectedId(propertyId);
    document
      .getElementById(`result-${propertyId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span className="brand-name">Roofing CRM</span>
        </div>
        <span className="county-badge">{DEFAULT_COUNTY.label}</span>
      </header>
      <Nav />
      <main className="app-main">
        <section className="map-pane" aria-label="Map">
          <MapView
            center={search.center}
            centerSource={search.centerSource}
            radiusMiles={search.radiusMiles}
            results={markers}
            selectedId={selectedId}
            onPick={(point) => {
              setNotice(null);
              dispatch({ type: 'pin', point });
            }}
            onSelect={selectRow}
            onProblem={setMapProblem}
          />
          <div className="map-overlays">
            {mapProblem ? (
              <Callout tone="error" title="Map unavailable">
                {mapProblem}
              </Callout>
            ) : null}
            {notice ? (
              <Callout
                tone={notice.tone}
                onDismiss={() => {
                  setNotice(null);
                }}
              >
                {notice.text}
              </Callout>
            ) : null}
          </div>
          <Legend roofAgeMin={search.roofAgeMin} />
        </section>
        <aside className="side-panel" aria-label="Search and results">
          <SearchPanel
            search={search}
            dispatch={dispatch}
            locating={locating}
            onLocate={() => {
              void locateUser();
            }}
            place={
              <PlaceBox
                client={client}
                centered={search.centerSource === 'place'}
                onChoose={(center) => {
                  setNotice(null);
                  dispatch({ type: 'place', point: { lat: center.lat, lon: center.lon } });
                }}
              />
            }
          />
          <ResultsPanel
            search={client ? propertySearch : null}
            retry={retry}
            roofAgeMin={search.roofAgeMin}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
      </main>
      <Footer config={config} meta={meta} />
    </div>
  );
}
