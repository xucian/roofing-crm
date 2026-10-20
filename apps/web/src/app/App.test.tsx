import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapViewProps } from '../map/MapView';
import { fixtureCenter, fixtureMeta, fixtureProperty } from '../test/fixtures';
import { App } from './App';

// The WebGL map cannot run in jsdom; a stub shows the props the app hands it.
vi.mock('../map/MapView', () => ({
  MapView: (props: MapViewProps) => (
    <div data-testid="map">{`${props.center.lat},${props.center.lon},${String(props.radiusMiles)}`}</div>
  ),
}));

function stubGeolocation(lat: number, lon: number): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback) => {
        success({
          coords: { latitude: lat, longitude: lon, accuracy: 10 },
          timestamp: 0,
        } as GeolocationPosition);
      },
    },
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('opens on the default search and writes it to the URL', () => {
    render(<App config={{ pipelineApiBase: null }} />);
    expect(screen.getByTestId('map')).toHaveTextContent('30.2672,-97.7431,5');
    expect(window.location.search).toBe('?lat=30.26720&lon=-97.74310&radius=5&age=15');
    expect(screen.getByText('Travis County, TX')).toBeInTheDocument();
  });

  it('starts from a shared link', () => {
    window.history.replaceState(null, '', '/?lat=30.4394&lon=-97.62&radius=2&age=30');
    render(<App config={{ pipelineApiBase: null }} />);
    expect(screen.getByTestId('map')).toHaveTextContent('30.4394,-97.62,2');
    expect(screen.getByText('Center from the link')).toBeInTheDocument();
  });

  it('keeps the Austin center and says so when GPS is outside Travis County (§4)', async () => {
    stubGeolocation(29.4241, -98.4936);
    render(<App config={{ pipelineApiBase: null }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(
      await screen.findByText(/outside Travis County, TX, so the search stays on Austin/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('30.2672,-97.7431,5');
  });

  it('moves the center to a GPS fix inside the county', async () => {
    stubGeolocation(30.3005, -97.7388);
    render(<App config={{ pipelineApiBase: null }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText('Your location')).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('30.3005,-97.7388,5');
  });

  it('says when the deployment has no pipeline API instead of showing rows', () => {
    render(<App config={{ pipelineApiBase: null }} />);
    expect(screen.getByText('Pipeline API not configured')).toBeInTheDocument();
    expect(
      screen.getByText(/not configured/, { selector: '.app-footer span' }),
    ).toBeInTheDocument();
  });
});

// The pipeline API answered by a stub of fetch, routed by path. Bodies are synthetic fixtures in the
// contract's shapes (src/test/fixtures.ts), never county data.
const API_BASE = 'https://pipeline.example.org';
type Route = (url: URL, call: number) => { status?: number; body: unknown; requestId?: string };

function stubPipeline(routes: Record<string, Route>) {
  const calls: URL[] = [];
  const counts = new Map<string, number>();
  vi.stubGlobal('fetch', (request: Request) => {
    const url = new URL(request.url);
    calls.push(url);
    const call = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, call);
    const route = routes[url.pathname];
    const answer = route ? route(url, call) : { status: 404, body: { error: 'not_found' } };
    return Promise.resolve(
      Response.json(answer.body, {
        status: answer.status ?? 200,
        headers: { 'x-request-id': answer.requestId ?? `req-${url.pathname}-${String(call)}` },
      }),
    );
  });
  return calls;
}

const searchPage = (
  items: ReturnType<typeof fixtureProperty>[],
  total: number,
  next: string | null,
) => ({
  body: { items, total, next_cursor: next, area_note: null },
});

describe('App with the pipeline API', () => {
  const config = { pipelineApiBase: API_BASE };

  it('runs the default search on load, then reads /v1/meta for the footer', async () => {
    const calls = stubPipeline({
      '/v1/properties/search': () => ({
        ...searchPage([fixtureProperty(1), fixtureProperty(2)], 1200, 'c2'),
        requestId: 'req-search-1',
      }),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);

    expect(await screen.findByText('1,200 matches, showing 2')).toBeInTheDocument();
    const first = screen.getByText('1 FIXTURE ST, TESTVILLE 00000').closest('li');
    expect(first).not.toBeNull();
    expect(within(first!).getByText('Aged roof')).toBeInTheDocument();
    expect(
      within(first!).getByText(/since 1990, year built on the appraisal roll/),
    ).toBeInTheDocument();
    expect(within(first!).getByText(/low confidence · as of 2026-10-20/)).toBeInTheDocument();
    expect(screen.getByText('req-search-1')).toBeInTheDocument();

    expect(await screen.findByText('fixture-run')).toBeInTheDocument();
    expect(screen.getByText('2 data group CIDs')).toBeInTheDocument();
    expect(screen.getByText(/Atlas: not published yet/)).toBeInTheDocument();

    expect(calls.map((url) => url.pathname)).toEqual(['/v1/properties/search', '/v1/meta']);
    expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({
      lat: '30.2672',
      lon: '-97.7431',
      radius_miles: '5',
      roof_age_min: '15',
      open_permits: 'false',
      limit: '500',
    });
  });

  it('loads the next page through the cursor', async () => {
    const calls = stubPipeline({
      '/v1/properties/search': (url) =>
        url.searchParams.get('cursor') === 'c2'
          ? searchPage([fixtureProperty(3)], 3, null)
          : searchPage([fixtureProperty(1), fixtureProperty(2)], 3, 'c2'),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('3 matches')).toBeInTheDocument();
    expect(screen.getByText('3 FIXTURE ST, TESTVILLE 00000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(calls.filter((url) => url.searchParams.get('cursor') === 'c2')).toHaveLength(1);
  });

  it('restarts the list from the first page after a stale cursor', async () => {
    const calls = stubPipeline({
      '/v1/properties/search': (url) =>
        url.searchParams.has('cursor')
          ? { status: 400, body: { error: 'stale_cursor', request_id: 'req-stale' } }
          : searchPage([fixtureProperty(1)], 2, 'c2'),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/the list restarted from the first page/)).toBeInTheDocument();
    const firstPages = calls.filter(
      (url) => url.pathname === '/v1/properties/search' && !url.searchParams.has('cursor'),
    );
    expect(firstPages).toHaveLength(2);
  });

  it('shows a failed search with its request id, and nothing in its place', async () => {
    stubPipeline({
      '/v1/properties/search': () => ({
        status: 400,
        body: { error: 'invalid_params', detail: 'fixture detail', request_id: 'req-bad' },
        requestId: 'req-bad',
      }),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);
    expect(await screen.findByText('Search failed')).toBeInTheDocument();
    expect(
      screen.getByText(/rejected the request \(HTTP 400: invalid_params\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('fixture detail')).toBeInTheDocument();
    expect(screen.getByText('req-bad')).toBeInTheDocument();
    expect(document.querySelector('.results-list')).toBeNull();
  });

  it('goes back to Austin when the server says a GPS fix is outside the county', async () => {
    stubGeolocation(30.0, -98.15);
    stubPipeline({
      '/v1/properties/search': (url) =>
        url.searchParams.get('lat') === '30'
          ? { body: { items: [], total: 0, next_cursor: null, area_note: 'outside Travis County' } }
          : searchPage([fixtureProperty(1)], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(
      await screen.findByText(/is outside Travis County, so the search stays on Austin/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('30.2672,-97.7431,5');
  });

  it('moves the center to the one exact place match', async () => {
    const calls = stubPipeline({
      '/v1/properties/search': () => searchPage([], 0, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/search-centers': () => ({
        body: {
          items: [
            fixtureCenter(),
            fixtureCenter({ name: 'FIXTUREVILLE EAST', match_type: 'prefix' }),
          ],
        },
      }),
    });
    render(<App config={config} />);
    await screen.findByText('No matches');
    await userEvent.type(screen.getByLabelText('City or ZIP'), 'fixtureville{Enter}');
    expect(
      await screen.findByText('Centered on FIXTUREVILLE · city · exact match · 1,234 parcels.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('30.4,-97.6,5');
    expect(screen.getByText('Place from the search box')).toBeInTheDocument();
    expect(calls.find((url) => url.pathname === '/v1/search-centers')?.searchParams.get('q')).toBe(
      'fixtureville',
    );
  });

  it('asks which place was meant when no match is exact', async () => {
    stubPipeline({
      '/v1/properties/search': () => searchPage([], 0, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/search-centers': () => ({
        body: {
          items: [
            fixtureCenter({ name: 'FIXTUREVILLE', match_type: 'prefix' }),
            fixtureCenter({ name: 'FIXTURE PARK', match_type: 'prefix', lat: 30.5, lon: -97.5 }),
          ],
        },
      }),
    });
    render(<App config={config} />);
    await screen.findByText('No matches');
    await userEvent.type(screen.getByLabelText('City or ZIP'), 'fix{Enter}');
    expect(
      await screen.findByText('No exact match. Which place did you mean?'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('30.2672,-97.7431,5');
    await userEvent.click(
      screen.getByRole('button', { name: /FIXTURE PARK · city · starts with your text/ }),
    );
    expect(screen.getByTestId('map')).toHaveTextContent('30.5,-97.5,5');
  });
});
