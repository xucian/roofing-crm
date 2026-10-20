/**
 * Sets some of the page's URL parameters and keeps the rest, without adding a history entry. The
 * search owns its parameters and the property drawer owns `property`, so each writes only its own.
 */
export function replaceUrlParams(entries: Iterable<readonly [string, string | null]>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of entries) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  const next = query ? `?${query}` : '';
  if (window.location.search !== next) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}`);
  }
}
