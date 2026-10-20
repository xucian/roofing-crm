import { useEffect, useState } from 'react';

/** The app's pages: the map with its results, the saved leads and the assistant. */
export type Route = 'map' | 'leads' | 'assistant';

export const ROUTE_PATHS: Readonly<Record<Route, string>> = {
  map: '/',
  leads: '/leads',
  assistant: '/assistant',
};

export function routeOf(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '');
  if (path === ROUTE_PATHS.leads) return 'leads';
  if (path === ROUTE_PATHS.assistant) return 'assistant';
  return 'map';
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
