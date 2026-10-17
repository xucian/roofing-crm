import type { GeoPoint } from '@roofing-crm/shared';

export type LocateFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export type LocateOutcome =
  | { kind: 'located'; point: GeoPoint; accuracyMeters: number }
  | { kind: 'failed'; reason: LocateFailure; message: string };

const MESSAGES: Record<LocateFailure, string> = {
  unsupported: 'This browser cannot share its location. Drop a pin on the map instead.',
  denied: 'Location access was denied. Allow it for this site, or drop a pin on the map.',
  unavailable: 'Your location could not be determined. Drop a pin on the map instead.',
  timeout: 'Finding your location took too long. Try again, or drop a pin on the map.',
};

const failed = (reason: LocateFailure): LocateOutcome => ({
  kind: 'failed',
  reason,
  message: MESSAGES[reason],
});

/** One position fix from the browser, as an outcome rather than an exception. */
export function locate(
  geolocation: Geolocation | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.geolocation,
  timeoutMs = 10_000,
): Promise<LocateOutcome> {
  if (!geolocation) return Promise.resolve(failed('unsupported'));
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve({
          kind: 'located',
          point: { lat: position.coords.latitude, lon: position.coords.longitude },
          accuracyMeters: position.coords.accuracy,
        });
      },
      (error) => {
        const reason: LocateFailure =
          error.code === error.PERMISSION_DENIED
            ? 'denied'
            : error.code === error.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        resolve(failed(reason));
      },
      // A fresh fix every time: a cached one would keep the place the user has since left.
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
