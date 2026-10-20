import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Nav } from './Nav';

describe('Nav', () => {
  it('marks the current section and counts the saved leads', () => {
    render(<Nav route="map" onNavigate={() => undefined} leadCount={3} />);
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Leads 3' })).not.toHaveAttribute('aria-current');
  });

  it('moves to the leads inside the app', async () => {
    const onNavigate = vi.fn();
    render(<Nav route="map" onNavigate={onNavigate} leadCount={null} />);
    await userEvent.click(screen.getByRole('link', { name: 'Leads' }));
    expect(onNavigate).toHaveBeenCalledWith('leads');
  });

  it('shows the five future sections disabled under "Coming soon" (README AC 11)', () => {
    render(<Nav route="map" onNavigate={() => undefined} leadCount={null} />);
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
