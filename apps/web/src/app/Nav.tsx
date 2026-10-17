import { DISABLED_SECTIONS } from '@roofing-crm/shared';

/** Sections: the map is live; the sections beyond lead identification are shown disabled (README AC 11). */
export function Nav() {
  return (
    <nav className="app-nav" aria-label="Sections">
      <ul className="nav-list">
        <li>
          <span className="nav-item nav-item--active" aria-current="page">
            Map
          </span>
        </li>
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
