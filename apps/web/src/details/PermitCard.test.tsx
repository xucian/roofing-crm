import type { PermitSummary } from '@roofing-crm/pipeline-client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixturePermit } from '../test/fixtures';
import { PermitCard } from './PermitCard';

const card = (permit: PermitSummary) =>
  render(
    <ul>
      <PermitCard permit={permit} />
    </ul>,
  ).container.querySelector('li');

describe('a permit in the drawer', () => {
  it('marks a roof job open five years or more, with no completed date, as long-open', () => {
    const item = card(fixturePermit(1, { open_duration_days: 2000 }));
    expect(screen.getByText('Long-open')).toBeInTheDocument();
    expect(screen.getByText('Open 5.4 years, since 2021-04-01 (issued)')).toBeInTheDocument();
    expect(item).toHaveClass('permit--long-open');
  });

  it('says a shed listed as open was completed, without the long-open badge, keeping its class', () => {
    // The shape of 1999-002931 BP: a storage shed printed "Active", completed 1999-07-04.
    const item = card(
      fixturePermit(1, {
        roof_work_class: 'accessory_roof',
        is_reroof: false,
        open_since: '1999-02-24',
        open_duration_days: 10151,
        completed_date: '1999-07-04',
      }),
    );
    expect(screen.getByText('Listed as open, but completed 1999-07-04')).toBeInTheDocument();
    expect(screen.queryByText(/^Open \d/)).not.toBeInTheDocument();
    expect(screen.queryByText('Long-open')).not.toBeInTheDocument();
    expect(item).not.toHaveClass('permit--long-open');
    expect(
      screen.getByText(/Accessory structure roof · printed status “Active”/),
    ).toBeInTheDocument();
  });

  it('never marks an accessory roof long-open, however long it has been open', () => {
    card(fixturePermit(1, { roof_work_class: 'accessory_roof', open_duration_days: 9000 }));
    expect(screen.queryByText('Long-open')).not.toBeInTheDocument();
    expect(screen.getByText('Open 24 years, since 2021-04-01 (issued)')).toBeInTheDocument();
  });
});
