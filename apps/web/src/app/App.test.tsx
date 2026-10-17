import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapViewProps } from '../map/MapView';
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
