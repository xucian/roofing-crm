import {
  DEFAULT_CENTER,
  DEFAULT_COUNTY,
  MAP_BOUNDS,
  formatCoordinates,
  isWithinBounds,
} from '@roofing-crm/shared';
import { useState } from 'react';
import type { RuntimeConfig } from '../config/runtime-config';
import { Legend } from '../map/Legend';
import { MapView } from '../map/MapView';
import { NO_RESULTS } from '../map/layers';
import { ResultsPanel } from '../results/ResultsPanel';
import { SearchPanel } from '../search/SearchPanel';
import { locate } from '../search/geolocation';
import { useSearchState } from '../search/use-search-state';
import { Callout, type CalloutTone } from './Callout';
import { Footer } from './Footer';
import { Nav } from './Nav';

interface Notice {
  tone: CalloutTone;
  text: string;
}

export function App({ config }: { config: RuntimeConfig }) {
  const [search, dispatch] = useSearchState();
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mapProblem, setMapProblem] = useState<string | null>(null);

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
    dispatch({ type: 'gps', point: outcome.point });
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
            results={NO_RESULTS}
            onPick={(point) => {
              setNotice(null);
              dispatch({ type: 'pin', point });
            }}
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
          />
          <ResultsPanel config={config} />
        </aside>
      </main>
      <Footer config={config} />
    </div>
  );
}
