import { addProtocol, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';

let ready = false;

/**
 * Once per page: point MapLibre at its worker, which the build emits as a same-origin asset (MapLibre 6
 * otherwise resolves it next to its own module, a path the bundle does not have), and register the
 * pmtiles:// protocol that reads the basemap archive with HTTP Range requests.
 */
export function setupMapLibre(): void {
  if (ready) return;
  ready = true;
  setWorkerUrl(new URL(workerUrl, window.location.href).href);
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
}
