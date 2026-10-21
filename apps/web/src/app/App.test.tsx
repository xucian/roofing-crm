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
import { fakeCrm, fixtureChatResponse, fixtureLead, type FakeCrm } from '../test/fake-crm';
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

// The CRM API's answers when a test does not set its own: an empty workspace.
let crm: FakeCrm;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  crm = fakeCrm();
  vi.stubGlobal('fetch', stubFetch({}));
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

// fetch as the page uses it: the pipeline client passes a Request, tRPC a URL string and init.
// `/api/trpc/*` goes to the fake CRM API; every other path is the pipeline's. Only pipeline calls are
// recorded in `calls`, so the order assertions below are about the pipeline queue alone.
function stubFetch(routes: Record<string, Route>, calls: URL[] = []) {
  const counts = new Map<string, number>();
  return (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname.startsWith('/api/trpc/')) return crm.handle(url, init);
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
  };
}

function stubPipeline(routes: Record<string, Route>) {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', stubFetch(routes, calls));
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
    await userEvent.click(await screen.findByRole('button', { name: /^1 FIXTURE ST/ }));

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

describe('F3: save leads', () => {
  const config = { pipelineApiBase: API_BASE };
  const routes = {
    '/v1/properties/search': () => searchPage([fixtureProperty(1), fixtureProperty(2)], 2, null),
    '/v1/meta': () => ({ body: fixtureMeta() }),
  };
  const workspaceId = (): string => window.localStorage.getItem('roofing-crm.workspace') ?? '';

  it('saves one row as a property lead and marks it saved', async () => {
    stubPipeline(routes);
    render(<App config={config} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save 1 FIXTURE ST, TESTVILLE 00000 as a lead' }),
    );

    expect(await screen.findByText('Saved 1 lead.')).toBeInTheDocument();
    const row = screen.getByText('1 FIXTURE ST, TESTVILLE 00000').closest('li');
    expect(within(row!).getByText('Saved as lead')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leads 1' })).toBeInTheDocument();
    expect(crm.calls.at(-1)).toEqual({
      procedure: 'leads.create',
      input: { workspace_id: workspaceId(), property_id: 'fx-1', permit_id: '' },
    });
    expect(workspaceId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('saves ticked rows together in one request', async () => {
    stubPipeline(routes);
    render(<App config={config} />);
    expect(await screen.findByText(/Tick rows to save several/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Select 1 FIXTURE ST, TESTVILLE 00000'));
    await userEvent.click(screen.getByLabelText('Select 2 FIXTURE ST, TESTVILLE 00000'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save 2 as leads' }));
    expect(await screen.findByText(/Saved 2 leads\./)).toBeInTheDocument();
    expect(crm.calls.at(-1)).toEqual({
      procedure: 'leads.createMany',
      input: {
        workspace_id: workspaceId(),
        rows: [
          { property_id: 'fx-1', permit_id: '' },
          { property_id: 'fx-2', permit_id: '' },
        ],
      },
    });
    expect(screen.getAllByText('Saved as lead')).toHaveLength(2);
    expect(screen.getByLabelText('Select 1 FIXTURE ST, TESTVILLE 00000')).toBeDisabled();
  });

  it('reports a row that failed with both request ids, and tries it again', async () => {
    crm.failRows.set('fx-2#', {
      code: 'not_found',
      message: 'Not found in the pipeline API (HTTP 404: not_found).',
      pipeline_request_id: 'pl-404',
    });
    stubPipeline(routes);
    render(<App config={config} />);
    await userEvent.click(await screen.findByLabelText('Select 1 FIXTURE ST, TESTVILLE 00000'));
    await userEvent.click(screen.getByLabelText('Select 2 FIXTURE ST, TESTVILLE 00000'));
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 as leads' }));

    expect(await screen.findByText('Some rows were not saved')).toBeInTheDocument();
    expect(screen.getByText(/Saved 1 lead\. 1 row failed\./)).toBeInTheDocument();
    expect(
      screen.getByText(/2 FIXTURE ST, TESTVILLE 00000: not in the pipeline/),
    ).toBeInTheDocument();
    expect(screen.getByText('pl-404')).toBeInTheDocument();
    expect(screen.getByText(/^crm-req-/)).toBeInTheDocument();

    crm.failRows.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Try the failed row again' }));
    expect(await screen.findByText('Saved 1 lead.')).toBeInTheDocument();
    expect(crm.calls.at(-1)?.procedure).toBe('leads.create');
  });

  it('saves a permit from the drawer as a permit lead', async () => {
    window.history.replaceState(null, '', '/?property=fx-1');
    stubPipeline({
      ...routes,
      '/v1/properties/fx-1': () => ({ body: fixtureDetail(1) }),
    });
    render(<App config={config} />);
    const drawer = await screen.findByRole('complementary', {
      name: '1 FIXTURE ST, TESTVILLE 00000',
    });
    await userEvent.click(
      await within(drawer).findByRole('button', { name: 'Save permit as lead' }),
    );
    expect(await within(drawer).findByText('Saved 1 lead.')).toBeInTheDocument();
    expect(crm.calls.at(-1)?.input).toMatchObject({ property_id: 'fx-1', permit_id: 'FX-1 BP' });
    expect(within(drawer).getByRole('button', { name: 'Save property as lead' })).toBeEnabled();
  });

  it('lists the saved leads on the Leads page after a reload, and shows one on the map', async () => {
    stubPipeline(routes);
    const first = render(<App config={config} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save 2 FIXTURE ST, TESTVILLE 00000 as a lead' }),
    );
    await screen.findByText('Saved 1 lead.');
    first.unmount();

    // A reload: the same browser workspace, read back from the CRM API.
    window.history.replaceState(null, '', '/leads');
    stubPipeline({ ...routes, '/v1/properties/fx-2': () => ({ body: fixtureDetail(2) }) });
    render(<App config={config} />);
    const page = await screen.findByRole('region', { name: /Leads/ });
    expect(await within(page).findByText('2 FIXTURE ST, TESTVILLE 00000')).toBeInTheDocument();
    expect(within(page).getByText('Property lead · property fx-2')).toBeInTheDocument();
    expect(
      within(page).getByRole('combobox', { name: 'Status of 2 FIXTURE ST, TESTVILLE 00000' }),
    ).toHaveValue('new');
    expect(within(page).getByText(/Longest-open roofing permit FX-1 BP/)).toBeInTheDocument();
    expect(within(page).getByText('Open 5.4 years, since 2021-04-01')).toBeInTheDocument();
    expect(within(page).getByText(/Contractor as printed: FIXTURE ROOFER/)).toBeInTheDocument();
    expect(within(page).getByText(/Snapshot of pipeline run/)).toBeInTheDocument();
    expect(within(page).getByText(workspaceId())).toBeInTheDocument();

    await userEvent.click(within(page).getByRole('link', { name: 'Show on map' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('region', { name: /Leads/ })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('complementary', { name: '2 FIXTURE ST, TESTVILLE 00000' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveTextContent('30.25,-97.75,5');
  });

  it('says so when the workspace has no leads yet', async () => {
    window.history.replaceState(null, '', '/leads');
    stubPipeline(routes);
    render(<App config={config} />);
    expect(await screen.findByText(/No leads yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leads 0' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('F4: manage leads', () => {
  const config = { pipelineApiBase: API_BASE };
  const routes = {
    '/v1/properties/search': () => searchPage([fixtureProperty(1), fixtureProperty(2)], 2, null),
    '/v1/meta': () => ({ body: fixtureMeta() }),
  };
  const WORKSPACE = '01JBQ7Z0000000000000000000';
  const ADDRESS = (n: number) => `${String(n)} FIXTURE ST, TESTVILLE 00000`;

  // Three leads that differ in every filtered field. The map's pin is Austin (30.2672, -97.7431):
  // fx-1 is about 1.3 miles from it, fx-2 about 9 miles, fx-3 about 0.5 miles.
  const seeded = {
    one: fixtureLead({ property_id: 'fx-1' }, 1),
    two: (() => {
      const lead = fixtureLead({ property_id: 'fx-2' }, 2);
      return {
        ...lead,
        status: 'working' as const,
        snapshot: {
          ...lead.snapshot,
          lat: 30.4,
          roof_age_years: 12,
          permit: lead.snapshot.permit && {
            ...lead.snapshot.permit,
            status_group: 'stalled' as const,
            open_duration_days: 4000,
            days_since_expiry: 90,
          },
        },
      };
    })(),
    three: (() => {
      const lead = fixtureLead({ property_id: 'fx-3' }, 3);
      return {
        ...lead,
        status: 'closed' as const,
        snapshot: { ...lead.snapshot, lat: 30.26, lon: -97.74, roof_age_years: 25, permit: null },
      };
    })(),
  };

  function openLeads(...leads: (keyof typeof seeded)[]) {
    window.localStorage.setItem('roofing-crm.workspace', WORKSPACE);
    for (const name of leads) crm.put(WORKSPACE, seeded[name]);
    window.history.replaceState(null, '', '/leads');
    stubPipeline(routes);
    return render(<App config={config} />);
  }
  const card = (n: number) => screen.findByRole('listitem', { name: ADDRESS(n) });
  const cards = () =>
    screen
      .queryAllByRole('listitem')
      .filter((item) => item.classList.contains('lead-card'))
      .map((item) => item.getAttribute('aria-label'));
  const lastList = () => crm.calls.filter((call) => call.procedure === 'leads.list').at(-1);
  const summary = async () => (await screen.findByText(/match(es)? the filters\./)).textContent;

  it('sets the status and the note, and both are there after a reload', async () => {
    const first = openLeads('one');
    const lead = await card(1);
    await userEvent.selectOptions(
      within(lead).getByRole('combobox', { name: `Status of ${ADDRESS(1)}` }),
      'working',
    );
    expect(await within(lead).findByText(/Status set to Working\./)).toHaveTextContent(
      /Request id crm-req-\d+/,
    );
    expect(crm.calls.at(-1)).toEqual({
      procedure: 'leads.update',
      input: { workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: '', status: 'working' },
    });

    await userEvent.click(within(lead).getByRole('button', { name: 'Add a note' }));
    await userEvent.type(within(lead).getByRole('textbox', { name: 'Note' }), 'Call after 5pm');
    expect(within(lead).getByText(/14 of 2,000 characters/)).toBeInTheDocument();
    await userEvent.click(within(lead).getByRole('button', { name: 'Save note' }));
    expect(await within(lead).findByText(/Note saved\./)).toBeInTheDocument();
    expect(within(lead).getByText('Call after 5pm')).toBeInTheDocument();
    expect(within(lead).queryByRole('textbox')).not.toBeInTheDocument();
    expect(crm.calls.at(-1)?.input).toMatchObject({ note: 'Call after 5pm' });
    first.unmount();

    render(<App config={config} />);
    const reloaded = await card(1);
    expect(within(reloaded).getByRole('combobox', { name: `Status of ${ADDRESS(1)}` })).toHaveValue(
      'working',
    );
    expect(within(reloaded).getByText('Call after 5pm')).toBeInTheDocument();
    expect(within(reloaded).getByRole('button', { name: 'Edit note' })).toBeInTheDocument();
  });

  it('cancels a note edit without a request', async () => {
    openLeads('one');
    const lead = await card(1);
    const calls = crm.calls.length;
    await userEvent.click(within(lead).getByRole('button', { name: 'Add a note' }));
    await userEvent.type(within(lead).getByRole('textbox', { name: 'Note' }), 'draft');
    await userEvent.click(within(lead).getByRole('button', { name: 'Cancel' }));
    expect(within(lead).queryByText('draft')).not.toBeInTheDocument();
    expect(crm.calls).toHaveLength(calls);
  });

  it('deletes a lead only after the confirmation, and the map can save it again', async () => {
    openLeads('one', 'three');
    const lead = await card(1);
    await userEvent.click(within(lead).getByRole('button', { name: 'Delete…' }));
    await userEvent.click(within(lead).getByRole('button', { name: 'Keep' }));
    expect(crm.calls.some((call) => call.procedure === 'leads.delete')).toBe(false);

    await userEvent.click(within(lead).getByRole('button', { name: 'Delete…' }));
    const confirm = within(lead).getByRole('group', { name: `Delete the lead for ${ADDRESS(1)}?` });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(`Deleted the lead for ${ADDRESS(1)}.`)).toBeInTheDocument();
    expect(cards()).toEqual([ADDRESS(3)]);
    expect(crm.calls.at(-1)).toEqual({
      procedure: 'leads.delete',
      input: { workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: '' },
    });
    expect(crm.leads(WORKSPACE).map((saved) => saved.property_id)).toEqual(['fx-3']);
    expect(screen.getByRole('link', { name: 'Leads 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Leads 1' }));
    await userEvent.click(screen.getByRole('link', { name: 'Map' }));
    expect(
      await screen.findByRole('button', { name: `Save ${ADDRESS(1)} as a lead` }),
    ).toBeEnabled();
  });

  it('filters by status and roof age in the leads function, and clears the filters', async () => {
    openLeads('one', 'two', 'three');
    await card(3);
    expect(cards()).toHaveLength(3);
    const status = screen.getByRole('group', { name: 'Status' });
    await userEvent.click(within(status).getByRole('checkbox', { name: 'Closed' }));
    expect(await summary()).toBe('2 of 3 leads match the filters.');
    expect(lastList()?.input.filter).toEqual({ statuses: ['new', 'working'] });
    expect(cards().sort()).toEqual([ADDRESS(1), ADDRESS(2)]);
    expect(screen.getByText(/^crm-req-/, { selector: '.leads-filter-summary code' })).toBeVisible();

    await userEvent.type(screen.getByRole('spinbutton', { name: /Roof older than/ }), '20');
    await waitForFilter({ statuses: ['new', 'working'], roof_age_min: 20 });
    expect(cards()).toEqual([ADDRESS(1)]);
    expect(await summary()).toBe('1 of 3 leads match the filters.');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await card(2)).toBeInTheDocument();
    expect(cards()).toHaveLength(3);
    expect(screen.queryByText(/match the filters/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
  });

  it('filters by permit group and open duration', async () => {
    openLeads('one', 'two', 'three');
    await card(3);
    const permit = screen.getByRole('group', { name: 'Permit' });
    for (const name of ['Open', 'Closed', 'Needs review']) {
      await userEvent.click(within(permit).getByRole('checkbox', { name }));
    }
    await waitForFilter({ permit_groups: ['stalled', 'none'] });
    expect(cards().sort()).toEqual([ADDRESS(2), ADDRESS(3)]);

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: /Permit open at least/ }), '6');
    await waitForFilter({ open_years_min: 6 });
    // fx-2's stalled permit was open 4,000 days; fx-1's open one 2,000 (under 6 x 365).
    expect(cards()).toEqual([ADDRESS(2)]);
  });

  it("filters by a radius around the map's pin, the map's radius unless one is typed", async () => {
    openLeads('one', 'two', 'three');
    await card(3);
    await userEvent.click(screen.getByRole('checkbox', { name: "Near the map's pin" }));
    await waitForFilter({ within: { lat: 30.2672, lon: -97.7431, radius_miles: 5 } });
    expect(cards().sort()).toEqual([ADDRESS(1), ADDRESS(3)]);
    const form = screen.getByRole('form', { name: 'Filter leads' });
    expect(within(form).getByText('30.26720, -97.74310')).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole('spinbutton', { name: "Miles from the map's pin" }),
      '0.8',
    );
    await waitForFilter({ within: { lat: 30.2672, lon: -97.7431, radius_miles: 0.8 } });
    expect(cards()).toEqual([ADDRESS(3)]);
  });

  it('keeps an edited lead the filters no longer match, marked, until they change', async () => {
    openLeads('one', 'two');
    await card(2);
    const status = screen.getByRole('group', { name: 'Status' });
    await userEvent.click(within(status).getByRole('checkbox', { name: 'Working' }));
    await waitForFilter({ statuses: ['new', 'closed'] });
    const lead = await card(1);
    await userEvent.selectOptions(
      within(lead).getByRole('combobox', { name: `Status of ${ADDRESS(1)}` }),
      'working',
    );
    expect(await within(lead).findByText(/No longer matches the filters/)).toBeInTheDocument();

    // Every status ticked again: no filter, so the page shows the whole list, edits included.
    await userEvent.click(within(status).getByRole('checkbox', { name: 'Working' }));
    await vi.waitFor(() => {
      expect(screen.queryByText(/match the filters/)).not.toBeInTheDocument();
    });
    expect(cards().sort()).toEqual([ADDRESS(1), ADDRESS(2)]);
    expect(within(await card(1)).queryByText(/No longer matches/)).not.toBeInTheDocument();
  });

  it('lists no lead while a filter is read, so the count always matches the cards shown', async () => {
    const slow = slowFilteredReads();
    openLeads('one', 'two', 'three');
    await card(3);
    const status = screen.getByRole('group', { name: 'Status' });
    await userEvent.click(within(status).getByRole('checkbox', { name: 'Closed' }));
    await slow.next();
    expect(await summary()).toBe('2 of 3 leads match the filters.');
    expect(cards().sort()).toEqual([ADDRESS(1), ADDRESS(2)]);

    // Typed fast while that answer shows: none of its cards stays without its count.
    await userEvent.type(screen.getByRole('spinbutton', { name: /Roof older than/ }), '20');
    await vi.waitFor(() => {
      expect(slow.waiting()).toBe(1);
    });
    expect(screen.getByText('Filtering leads…')).toBeInTheDocument();
    expect(cards()).toEqual([]);
    slow.release();
    expect(await summary()).toBe('1 of 3 leads match the filters.');
    expect(cards()).toEqual([ADDRESS(1)]);

    // After "Clear filters", the next read shows no older filter's answer either.
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cards()).toHaveLength(3);
    await userEvent.click(within(status).getByRole('checkbox', { name: 'New' }));
    await vi.waitFor(() => {
      expect(slow.waiting()).toBe(1);
    });
    expect(screen.getByText('Filtering leads…')).toBeInTheDocument();
    expect(cards()).toEqual([]);
    slow.release();
    expect(await summary()).toBe('2 of 3 leads match the filters.');
    expect(cards().sort()).toEqual([ADDRESS(2), ADDRESS(3)]);
  });

  it('drops a lead that an edit finds deleted elsewhere, and says so', async () => {
    openLeads('one', 'three');
    const lead = await card(1);
    // Deleted from another tab of the same workspace.
    await crm.handle(new URL('/api/trpc/leads.delete', window.location.href), {
      method: 'POST',
      body: JSON.stringify({ workspace_id: WORKSPACE, property_id: 'fx-1', permit_id: '' }),
    });
    await userEvent.selectOptions(
      within(lead).getByRole('combobox', { name: `Status of ${ADDRESS(1)}` }),
      'closed',
    );
    expect(
      await screen.findByText(
        `The lead for ${ADDRESS(1)} was deleted elsewhere, so it has left the list.`,
      ),
    ).toBeInTheDocument();
    expect(cards()).toEqual([ADDRESS(3)]);
  });

  /** Holds each filtered `leads.list` read until it is released, as a slow `leads` function would. */
  function slowFilteredReads() {
    const handle = crm.handle;
    const held: (() => void)[] = [];
    crm.handle = (url, init) =>
      url.pathname.endsWith('/leads.list') && url.searchParams.get('input')?.includes('"filter"')
        ? new Promise<void>((resolve) => held.push(resolve)).then(() => handle(url, init))
        : handle(url, init);
    const release = (): void => {
      for (const resolve of held.splice(0)) resolve();
    };
    return {
      waiting: () => held.length,
      release,
      /** Releases the next read as soon as it is sent. */
      next: () =>
        vi.waitFor(() => {
          expect(held).toHaveLength(1);
          release();
        }),
    };
  }

  /** Waits until the page has read the list with this filter and shows the answer. */
  async function waitForFilter(filter: Record<string, unknown>): Promise<void> {
    await vi.waitFor(() => {
      expect(lastList()?.input.filter).toEqual(filter);
    });
    await vi.waitFor(() => {
      expect(screen.queryByText('Filtering leads…')).not.toBeInTheDocument();
    });
  }
});

describe('F5: ask the assistant', () => {
  const config = { pipelineApiBase: API_BASE };
  const routes = {
    '/v1/properties/search': () => searchPage([fixtureProperty(1)], 1, null),
    '/v1/meta': () => ({ body: fixtureMeta() }),
    '/v1/properties/fx-1': () => ({ body: fixtureDetail(1) }),
  };
  const chats = () => crm.calls.filter((call) => call.procedure === 'agent.chat');

  it("answers the README's question with citations, records, assumptions and limitations", async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    render(<App config={config} />);
    expect(screen.getByRole('link', { name: 'Assistant' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Show me open roofing permits older than five years within five miles of Austin',
      }),
    );
    expect(await screen.findByText('Answered')).toBeInTheDocument();
    expect(screen.getByText(/around AUSTIN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permit FX-1 BP' })).toBeInTheDocument();
    expect(screen.getByText(/read as open five years or more/)).toBeInTheDocument();
    expect(screen.getByText('Records found (1)')).toBeInTheDocument();
    expect(screen.getByText(/BBB is blocked at the source/)).toBeInTheDocument();
    expect(screen.getByText(/How it searched \(1 tool calls\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/^crm-req-/, { selector: '.results-request code' }),
    ).toBeInTheDocument();
    // This answer offers nothing to save, so there is no Save button under it.
    expect(screen.queryByRole('button', { name: /^Save \d+ as/ })).not.toBeInTheDocument();

    const [first] = chats();
    expect(first?.input).toMatchObject({
      workspace_id: window.localStorage.getItem('roofing-crm.workspace'),
      messages: [
        {
          role: 'user',
          content: 'Show me open roofing permits older than five years within five miles of Austin',
        },
      ],
      map_center: { lat: 30.2672, lon: -97.7431 },
    });
    expect(first?.input.session_id).toMatch(/^[0-9A-Z]{26}$/);

    // A citation opens its property on the map.
    await userEvent.click(screen.getByRole('button', { name: 'Property fx-1' }));
    expect(window.location.pathname).toBe('/');
    expect(
      await screen.findByRole('complementary', { name: '1 FIXTURE ST, TESTVILLE 00000' }),
    ).toBeInTheDocument();
  });

  it("says a cited property's distance is from the map's pin, not the answer's center", async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline({
      ...routes,
      '/v1/properties/search': () =>
        searchPage([fixtureProperty(1, { distance_miles: 8.2 })], 1, null),
    });
    render(<App config={config} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Long-open permits near Austin?{Enter}',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Property fx-1' }));
    const drawer = await screen.findByRole('complementary', {
      name: '1 FIXTURE ST, TESTVILLE 00000',
    });
    expect(await within(drawer).findByText(/8\.2 mi from the map's pin/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/from the center/)).not.toBeInTheDocument();
  });

  it('sends the earlier exchange as history with the next question', async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    render(<App config={config} />);
    const box = screen.getByRole('textbox', { name: 'Your question' });
    await userEvent.type(box, 'Long-open permits near Austin?{Enter}');
    await screen.findByText('Answered');
    await userEvent.type(box, 'Save the first one as a lead{Enter}');
    await vi.waitFor(() => {
      expect(chats()).toHaveLength(2);
    });
    expect(chats()[1]?.input.messages).toEqual([
      { role: 'user', content: 'Long-open permits near Austin?' },
      {
        role: 'assistant',
        content:
          'One long-open permit:\n- [[permit:FX-1 BP]] on [[property:fx-1]], open 8.2 years.',
      },
      { role: 'user', content: 'Save the first one as a lead' },
    ]);
  });

  it('scrolls the latest question and its answer into view', async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    const scrolled: Element[] = [];
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    render(<App config={config} />);
    const box = screen.getByRole('textbox', { name: 'Your question' });
    await userEvent.type(box, 'Long-open permits near Austin?{Enter}');
    await screen.findByText('Answered');
    await userEvent.type(box, 'And older roofs?{Enter}');
    await vi.waitFor(() => {
      expect(screen.getAllByText('Answered')).toHaveLength(2);
    });
    const second = screen.getByText('And older roofs?').closest('li');
    expect(second).not.toBeNull();
    expect(scrolled.at(-1)).toBe(second);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start', behavior: 'smooth' });
    scroll.mockRestore();
  });

  it('reads the leads again when a turn saved some', async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    const workspace = '01JBQ7Z0000000000000000000';
    window.localStorage.setItem('roofing-crm.workspace', workspace);
    crm.chat = (_, requestId) => {
      crm.put(workspace, fixtureLead({ property_id: 'fx-1', permit_id: 'FX-1 BP' }, 1));
      return fixtureChatResponse(requestId, {
        leads_created: [
          {
            lead_id: '01JBQ80000000000000000000A',
            property_id: 'fx-1',
            permit_id: 'FX-1 BP',
            outcome: 'created',
          },
        ],
      });
    };
    render(<App config={config} />);
    expect(await screen.findByRole('link', { name: 'Leads 0' })).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Save FX-1 BP as a lead{Enter}',
    );
    expect(await screen.findByText('Saved to your leads')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Leads 1' })).toBeInTheDocument();
  });

  /** An answer offering permit FX-1 BP and property fx-2, both cited, for its Save button. */
  const offering = (requestId: string) =>
    fixtureChatResponse(requestId, {
      answer: 'Two long-open leads: [[permit:FX-1 BP]] and [[property:fx-2]].',
      evidence: [
        ...fixtureChatResponse(requestId).evidence,
        {
          kind: 'property',
          tool_call_id: 't1',
          property_id: 'fx-2',
          permit_id: null,
          contractor_attribution_key: null,
          record_cid: null,
          source_url: null,
          label: '2 FIXTURE ST, TESTVILLE 00000',
        },
      ],
      save_offer: [
        { property_id: 'fx-1', permit_id: 'FX-1 BP' },
        { property_id: 'fx-2', permit_id: '' },
      ],
    });

  it('saves the records an answer offers with its Save button, as the map saves ticked rows', async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    crm.chat = (_, requestId) => offering(requestId);
    render(<App config={config} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Long-open leads near Austin?{Enter}',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save 2 as leads' }));

    expect(await screen.findByText(/Saved 2 leads\./)).toBeInTheDocument();
    expect(crm.calls.at(-1)).toEqual({
      procedure: 'leads.createMany',
      input: {
        workspace_id: window.localStorage.getItem('roofing-crm.workspace'),
        rows: [
          { property_id: 'fx-1', permit_id: 'FX-1 BP' },
          { property_id: 'fx-2', permit_id: '' },
        ],
      },
    });
    // No model turn saves them, and the answer now shows them saved.
    expect(chats()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Save 2 as leads' })).not.toBeInTheDocument();
    expect(screen.getByText('Saved as leads')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Leads 2' })).toBeInTheDocument();
  });

  it('reports an offered record that failed with both request ids, and tries it again', async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    crm.chat = (_, requestId) => offering(requestId);
    crm.failRows.set('fx-2#', {
      code: 'not_found',
      message: 'Not found in the pipeline API (HTTP 404: not_found).',
      pipeline_request_id: 'pl-404',
    });
    render(<App config={config} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Long-open leads near Austin?{Enter}',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save 2 as leads' }));

    expect(await screen.findByText('Some rows were not saved')).toBeInTheDocument();
    expect(screen.getByText(/Saved 1 lead\. 1 row failed\./)).toBeInTheDocument();
    expect(
      screen.getByText(/2 FIXTURE ST, TESTVILLE 00000: not in the pipeline/),
    ).toBeInTheDocument();
    expect(screen.getByText('pl-404')).toBeInTheDocument();
    // The button saves what is left; the report retries the failed row, as on the map.
    expect(screen.getByRole('button', { name: 'Save 1 as a lead' })).toBeInTheDocument();
    crm.failRows.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Try the failed row again' }));
    expect(await screen.findByText('Saved 1 lead.')).toBeInTheDocument();
    expect(crm.calls.at(-1)).toMatchObject({
      procedure: 'leads.create',
      input: { property_id: 'fx-2', permit_id: '' },
    });
    expect(screen.getByText('Saved as leads')).toBeInTheDocument();
  });

  it('says why the assistant refused, with the request id', async () => {
    window.history.replaceState(null, '', '/assistant');
    stubPipeline(routes);
    crm.chat = () => 503;
    render(<App config={config} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Old roofs?{Enter}',
    );
    expect(await screen.findByText('The assistant did not answer')).toBeInTheDocument();
    expect(screen.getByText(/daily budget is used up/)).toBeInTheDocument();
    expect(screen.getByText(/^crm-req-/)).toBeInTheDocument();
  });
});
