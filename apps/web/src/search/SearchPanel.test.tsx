import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPanel } from './SearchPanel';
import { DEFAULT_SEARCH, searchReducer, type SearchAction } from './search-state';

/** The panel on the app's reducer, so a committed value comes back clamped as in the app. */
function ReducedPanel() {
  const [search, dispatch] = useReducer(searchReducer, DEFAULT_SEARCH);
  return <SearchPanel search={search} dispatch={dispatch} locating={false} onLocate={vi.fn()} />;
}

function setup(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  const actions: SearchAction[] = [];
  const onLocate = vi.fn();
  render(
    <SearchPanel
      search={DEFAULT_SEARCH}
      dispatch={(action) => actions.push(action)}
      locating={false}
      onLocate={onLocate}
      {...overrides}
    />,
  );
  return { actions, onLocate };
}

describe('SearchPanel', () => {
  it('shows the default center with its coordinates', () => {
    setup();
    expect(screen.getByText('Austin (default center)')).toBeInTheDocument();
    expect(screen.getByText('30.26720, -97.74310')).toBeInTheDocument();
  });

  it('commits a typed radius and a slider move', async () => {
    const { actions } = setup();
    const radius = screen.getByLabelText('Radius');
    await userEvent.clear(radius);
    await userEvent.type(radius, '2.5');
    expect(actions).toContainEqual({ type: 'radius', miles: 2.5 });
    fireEvent.change(screen.getByLabelText('Radius in miles'), { target: { value: '12' } });
    expect(actions).toContainEqual({ type: 'radius', miles: 12 });
  });

  it('commits an out-of-range value on blur so the reducer can clamp it', async () => {
    const { actions } = setup();
    const age = screen.getByLabelText('Roofs older than');
    await userEvent.clear(age);
    await userEvent.type(age, '250');
    expect(actions).not.toContainEqual({ type: 'roofAgeMin', years: 250 });
    await userEvent.tab();
    expect(actions).toContainEqual({ type: 'roofAgeMin', years: 250 });
  });

  it('says the radius maximum while more is typed, and after the blur clamps it to 25', async () => {
    render(<ReducedPanel />);
    const radius = screen.getByLabelText('Radius');
    await userEvent.clear(radius);
    await userEvent.type(radius, '30');
    expect(screen.getByRole('status')).toHaveTextContent('Maximum radius is 25 mi.');
    expect(radius).toHaveAttribute('aria-invalid', 'true');
    expect(radius).toHaveAccessibleDescription('Maximum radius is 25 mi.');

    await userEvent.tab();
    expect(radius).toHaveValue(25);
    expect(screen.getByRole('status')).toHaveTextContent('Maximum radius is 25 mi.');
    expect(radius).not.toHaveAttribute('aria-invalid');

    await userEvent.clear(radius);
    await userEvent.type(radius, '12');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(radius).toHaveValue(12);
  });

  it('asks for the location and disables the button while locating', async () => {
    const { onLocate } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(onLocate).toHaveBeenCalledOnce();
  });

  it('shows the locating state', () => {
    setup({ locating: true });
    expect(screen.getByRole('button', { name: 'Locating…' })).toBeDisabled();
  });

  it('resets to the defaults', async () => {
    const { actions } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to the Austin defaults' }));
    expect(actions).toContainEqual({ type: 'reset' });
  });
});
