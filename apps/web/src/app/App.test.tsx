import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapViewProps } from '../map/MapView';
import {
  fixtureCenter,
  fixtureDetail,
  fixtureMeta,
  fixturePermit,
  fixtureProperty,
} from '../test/fixtures';
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
    expect(window.location.search).toBe('?lat=30.26720&lon=-97.74310&radius=5&age=15&permits=1');
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

  it('reads /v1/meta first, so the default search behind it lands on a warm pipeline', async () => {
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

    expect(calls.map((url) => url.pathname)).toEqual(['/v1/meta', '/v1/properties/search']);
    expect(Object.fromEntries(calls[1]!.searchParams)).toEqual({
      lat: '30.2672',
      lon: '-97.7431',
      radius_miles: '5',
      roof_age_min: '15',
      open_permits: 'true',
      long_open_years: '5',
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

  it('runs a failed search again on "Try again"', async () => {
    stubPipeline({
      '/v1/properties/search': (_url, call) =>
        // A 400 is never retried by the transport, so the button is the only way to run it again.
        call === 1
          ? { status: 400, body: { error: 'invalid_params', request_id: 'req-first' } }
          : searchPage([fixtureProperty(1)], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);
    expect(await screen.findByText('Search failed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(screen.queryByText('Search failed')).not.toBeInTheDocument();
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

describe('F2: permit signal and property detail', () => {
  const config = { pipelineApiBase: API_BASE };
  const permitRow = fixtureProperty(1, {
    match_reasons: ['aged_roof', 'open_roofing_permit', 'long_open_roofing_permit'],
    roofing_permit_counts: { open: 1, stalled: 1, closed: 1, needs_review: 0 },
  });

  it('turns the open-permit signal off and on from the search panel', async () => {
    const calls = stubPipeline({
      '/v1/properties/search': () => searchPage([permitRow], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
    });
    render(<App config={config} />);
    expect(
      await screen.findByText('Roofing permits: 1 open, 1 stalled, 1 closed'),
    ).toBeInTheDocument();
    expect(screen.getByText('Permit open 5+ years')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Open and stalled roofing permits'));
    await vi.waitFor(() => {
      expect(calls.at(-1)?.searchParams.get('open_permits')).toBe('false');
    });
    expect(new URLSearchParams(window.location.search).get('permits')).toBe('0');
    expect(screen.queryByText('Permit open 5+ years')).not.toBeInTheDocument();
  });

  it('opens a row in the drawer: permits by status, contractor, BBB, owner and sources', async () => {
    const calls = stubPipeline({
      '/v1/properties/search': () => searchPage([permitRow], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/properties/fx-1': () => ({
        requestId: 'req-detail-1',
        body: fixtureDetail(1, {
          permits: [
            fixturePermit(1, { status: 'Final', status_group: 'closed', open_duration_days: null }),
            fixturePermit(2, { open_duration_days: 2000 }),
            fixturePermit(3, {
              status: 'Expired',
              status_group: 'stalled',
              open_duration_days: 180,
              open_duration_basis: 'expires_date',
              days_since_expiry: 1241,
              bbb: { rating: null, status: 'unavailable', incomplete_reason: null, note: null },
            }),
            fixturePermit(4, {
              is_roofing: false,
              roof_work_class: 'other',
              permit_type: 'EP',
              description: 'Fixture panel upgrade',
              status_group: 'closed',
              open_duration_days: null,
              bbb: { rating: 'A+', status: 'available', incomplete_reason: null, note: null },
            }),
          ],
        }),
      }),
    });
    render(<App config={config} />);
    await userEvent.click(await screen.findByRole('button', { name: /1 FIXTURE ST/ }));

    const drawer = await screen.findByRole('complementary', {
      name: '1 FIXTURE ST, TESTVILLE 00000',
    });
    expect(await within(drawer).findByText('req-detail-1')).toBeInTheDocument();
    expect(window.location.search).toContain('property=fx-1');
    expect(calls.map((url) => url.pathname)).toEqual([
      '/v1/meta',
      '/v1/properties/search',
      '/v1/properties/fx-1',
    ]);

    // Roofing permits in the permit search's order: open (longest first), stalled, closed.
    const ids = within(drawer)
      .getAllByText(/^FX-\d BP$/)
      .map((node) => node.textContent);
    expect(ids).toEqual(['FX-2 BP', 'FX-3 BP', 'FX-1 BP', 'FX-4 BP']);
    expect(
      within(drawer).getByText('Open 5.4 years, since 2021-04-01 (issued)'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('Long-open')).toBeInTheDocument();
    expect(
      within(drawer).getByText(/Was open 5 months, since 2021-04-01 \(issued\) until it expired/),
    ).toBeInTheDocument();
    expect(within(drawer).getAllByText('FIXTURE ROOFER')).toHaveLength(4);
    expect(
      within(drawer).getAllByText(
        'As printed on the permit: an attribution, not a verified identity.',
      ),
    ).toHaveLength(4);
    expect(within(drawer).getAllByText('Blocked at source')).toHaveLength(2);
    expect(within(drawer).getByText('No BBB profile')).toBeInTheDocument();
    expect(within(drawer).getByText('Rating A+')).toBeInTheDocument();
    expect(
      within(drawer).getByText('BBB: Fixture note: BBB blocks scripted access.'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText(/Other permits on this property \(1\)/)).toBeInTheDocument();

    expect(within(drawer).getByText('FIXTURE OWNER')).toBeInTheDocument();
    expect(within(drawer).getByText('PO BOX 0, TESTVILLE TX 00000')).toBeInTheDocument();
    expect(within(drawer).getByText('25.7 years')).toBeInTheDocument();
    expect(within(drawer).getByText('Long-open roofing permit')).toBeInTheDocument();
    expect(
      within(drawer).getByText(/geo_id, owner_name, mailing_address, deed_date from/),
    ).toBeInTheDocument();
  });

  it('opens the drawer from a shared link, behind /v1/meta, and closes it', async () => {
    window.history.replaceState(null, '', '/?property=fx-7');
    const calls = stubPipeline({
      '/v1/properties/search': () => searchPage([permitRow], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/properties/fx-7': () => ({ body: fixtureDetail(7) }),
    });
    render(<App config={config} />);
    const drawer = await screen.findByRole('complementary', {
      name: '7 FIXTURE ST, TESTVILLE 00000',
    });
    await screen.findByText('1 match');
    // One call at a time: /v1/meta takes the cold start, then the linked property, then the search.
    expect(calls.map((url) => url.pathname)).toEqual([
      '/v1/meta',
      '/v1/properties/fx-7',
      '/v1/properties/search',
    ]);
    expect(
      within(drawer).getByRole('heading', { name: '7 FIXTURE ST, TESTVILLE 00000' }),
    ).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: /FIXTURE ST/ })).not.toBeInTheDocument();
    expect(window.location.search).not.toContain('property=');
  });

  it('closes on Escape after focus has left the drawer, e.g. for the permit toggle', async () => {
    window.history.replaceState(null, '', '/?property=fx-7');
    stubPipeline({
      '/v1/properties/search': () => searchPage([permitRow], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/properties/fx-7': () => ({ body: fixtureDetail(7) }),
    });
    render(<App config={config} />);
    await screen.findByRole('complementary', { name: '7 FIXTURE ST, TESTVILLE 00000' });
    screen.getByLabelText('Open and stalled roofing permits').focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: /FIXTURE ST/ })).not.toBeInTheDocument();
    expect(window.location.search).not.toContain('property=');
  });

  it('shows a failed property read with its request id and reads it again on "Try again"', async () => {
    window.history.replaceState(null, '', '/?property=fx-1');
    stubPipeline({
      '/v1/properties/search': () => searchPage([permitRow], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/properties/fx-1': (_url, call) =>
        call === 1
          ? {
              status: 404,
              body: { error: 'not_found', request_id: 'req-missing' },
              requestId: 'req-missing',
            }
          : { body: fixtureDetail(1) },
    });
    render(<App config={config} />);
    expect(await screen.findByText('The property could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('req-missing')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('FIXTURE OWNER')).toBeInTheDocument();
  });

  it('pages the permits beyond the embedded ones through the permit search', async () => {
    window.history.replaceState(null, '', '/?property=fx-1');
    const calls = stubPipeline({
      '/v1/properties/search': () => searchPage([permitRow], 1, null),
      '/v1/meta': () => ({ body: fixtureMeta() }),
      '/v1/properties/fx-1': () => ({
        body: fixtureDetail(1, {
          permits: [fixturePermit(1)],
          permits_total: 3,
          permits_truncated: true,
        }),
      }),
      '/v1/permits/search': () => ({
        body: {
          items: [fixturePermit(1), fixturePermit(2), fixturePermit(3)],
          total: 3,
          next_cursor: null,
          area_note: null,
        },
      }),
    });
    render(<App config={config} />);
    expect(await screen.findByText('Showing 1 of 3 permits.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more permits' }));
    expect(await screen.findByText('Showing 3 of 3 permits.')).toBeInTheDocument();
    expect(screen.getByText('FX-3 BP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more permits' })).not.toBeInTheDocument();
    const permitSearch = calls.find((url) => url.pathname === '/v1/permits/search');
    expect(Object.fromEntries(permitSearch?.searchParams ?? [])).toEqual({
      property_id: 'fx-1',
      status_group: 'open,stalled,closed,needs_review',
      roofing_only: 'false',
      limit: '500',
    });
  });
});
