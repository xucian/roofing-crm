import { DISABLED_SECTIONS, formatCount } from '@roofing-crm/shared';
import { ROUTE_PATHS, type Route } from './use-route';

export interface NavProps {
  route: Route;
  onNavigate: (route: Route) => void;
  /** The saved leads, once known. */
  leadCount: number | null;
}

const LIVE: readonly { route: Route; label: string }[] = [
  { route: 'map', label: 'Map' },
  { route: 'leads', label: 'Leads' },
  { route: 'assistant', label: 'Assistant' },
];

/**
 * Sections: the map, the leads and the assistant are live; the sections beyond lead identification
 * are shown disabled (README AC 11).
 */
export function Nav({ route, onNavigate, leadCount }: NavProps) {
  return (
    <nav className="app-nav" aria-label="Sections">
      <ul className="nav-list">
        {LIVE.map((item) => (
          <li key={item.route}>
            <a
              href={ROUTE_PATHS[item.route]}
              className={item.route === route ? 'nav-item nav-item--active' : 'nav-item'}
              aria-current={item.route === route ? 'page' : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                onNavigate(item.route);
              }}
            >
              {item.label}{' '}
              {item.route === 'leads' && leadCount !== null ? (
                <span className="nav-count">{formatCount(leadCount)}</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
      <p className="nav-group-label" id="nav-coming-soon">
        Coming soon
      </p>
      <ul className="nav-list" aria-labelledby="nav-coming-soon">
        {DISABLED_SECTIONS.map((section) => (
          <li key={section.id}>
            <span
              className="nav-item nav-item--disabled"
              aria-disabled="true"
              title={`${section.summary} (coming soon)`}
            >
              {section.label}
              <span className="nav-badge">Soon</span>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
