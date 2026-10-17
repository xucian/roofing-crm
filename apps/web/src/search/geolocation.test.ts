import { describe, expect, it } from 'vitest';
import { locate } from './geolocation';

const codes = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as const;

function fakeGeolocation(result: { lat: number; lon: number } | { code: 1 | 2 | 3 }): Geolocation {
  return {
    getCurrentPosition(success, failure) {
      if ('code' in result) {
        failure?.({ ...codes, code: result.code, message: 'fake' });
      } else {
        success({
          coords: { latitude: result.lat, longitude: result.lon, accuracy: 25 },
          timestamp: 0,
        } as GeolocationPosition);
      }
    },
    watchPosition: () => 0,
    clearWatch: () => undefined,
  };
}

describe('locate', () => {
  it('returns the fix', async () => {
    await expect(locate(fakeGeolocation({ lat: 30.3, lon: -97.7 }))).resolves.toEqual({
      kind: 'located',
      point: { lat: 30.3, lon: -97.7 },
      accuracyMeters: 25,
    });
  });

  it('turns each browser failure into a message', async () => {
    await expect(locate(fakeGeolocation({ code: 1 }))).resolves.toMatchObject({ reason: 'denied' });
    await expect(locate(fakeGeolocation({ code: 2 }))).resolves.toMatchObject({
      reason: 'unavailable',
    });
    await expect(locate(fakeGeolocation({ code: 3 }))).resolves.toMatchObject({
      reason: 'timeout',
    });
  });

  it('handles a browser without geolocation', async () => {
    const outcome = await locate(undefined);
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'unsupported' });
  });

  it('asks for a fresh fix, never a cached one from where the user was before', async () => {
    const seen: (PositionOptions | undefined)[] = [];
    const geolocation = fakeGeolocation({ lat: 30.3, lon: -97.7 });
    const spy: Geolocation = {
      getCurrentPosition(success, failure, options) {
        seen.push(options);
        geolocation.getCurrentPosition(success, failure, options);
      },
      watchPosition: () => 0,
      clearWatch: () => undefined,
    };
    await locate(spy, 5000);
    expect(seen).toEqual([{ enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }]);
  });
});
