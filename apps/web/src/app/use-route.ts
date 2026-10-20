import { useEffect, useState } from 'react';

/** The app's pages: the map with its results, and the saved leads. */
export type Route = 'map' | 'leads';

export const ROUTE_PATHS: Readonly<Record<Route, string>> = { map: '/', leads: '/leads' };

export function routeOf(pathname: string): Route {
  return pathname.replace(/\/+$/, '') === ROUTE_PATHS.leads ? 'leads' : 'map';
}

/**
 * The page from the URL path, kept in the browser history. The query string stays as it is, so the
 * map's search and open property survive a visit to the leads. CloudFront serves index.html for
 * `/leads` (the SPA routing function), so a reload or a shared link lands on the same page.
 */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname));

  useEffect(() => {
    const onPopState = (): void => {
      setRoute(routeOf(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const navigate = (next: Route): void => {
    if (routeOf(window.location.pathname) !== next) {
      window.history.pushState(null, '', `${ROUTE_PATHS[next]}${window.location.search}`);
    }
    setRoute(next);
  };
  return [route, navigate];
}
