import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Nav } from './Nav';

describe('Nav', () => {
  it('marks the map as the current section', () => {
    render(<Nav />);
    expect(screen.getByText('Map')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the five future sections disabled under "Coming soon" (README AC 11)', () => {
    render(<Nav />);
    const soon = screen.getByRole('list', { name: 'Coming soon' });
    const items = within(soon).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'OutreachSoon',
      'CampaignsSoon',
      'SequencesSoon',
      'ReportingSoon',
      'BillingSoon',
    ]);
    for (const item of items) {
      expect(item.firstElementChild).toHaveAttribute('aria-disabled', 'true');
      expect(item.querySelector('a, button')).toBeNull();
    }
  });
});
