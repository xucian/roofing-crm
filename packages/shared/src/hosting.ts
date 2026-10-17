const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates and normalizes the pipeline API base (`API_BASE`), the CRM's single environment input
 * (metagross item 2): an absolute https URL without query, fragment, credentials or trailing slash.
 * Plain http is accepted for localhost only, for a pipeline running locally.
 */
export function normalizePipelineApiBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`The pipeline API base is not an absolute URL: "${value}"`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('The pipeline API base must use https (http is accepted for localhost only)');
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('The pipeline API base must not carry a query, a fragment or credentials');
  }
  return url.href.replace(/\/+$/, '');
}

export interface ContentSecurityPolicyOptions {
  /** Origins the page may call besides itself: the pipeline API. */
  connectOrigins: readonly string[];
  /** On for the HTTPS deployment; off for a local http preview. */
  upgradeInsecureRequests: boolean;
}

/**
 * The page's Content-Security-Policy. Everything is same-origin except the pipeline API: the app,
 * MapLibre's module worker, the PMTiles basemap, its glyphs and sprites are all served from the
 * CRM's own origin, so no third-party host and no `unsafe-*` source is allowed.
 */
export function contentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const connect = ["'self'", ...new Set(options.connectOrigins)].join(' ');
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Browser features the page may use: geolocation for "use my location", nothing else. */
export const PERMISSIONS_POLICY =
  'geolocation=(self), camera=(), microphone=(), payment=(), usb=()';
