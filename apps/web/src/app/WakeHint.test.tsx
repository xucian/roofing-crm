import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WAKE_HINT_AFTER_MS, WakeHint } from './WakeHint';

afterEach(() => {
  vi.useRealTimers();
});

describe('WakeHint', () => {
  it('explains a slow call only after about 3 s', () => {
    vi.useFakeTimers();
    render(<WakeHint what="search" />);
    expect(screen.queryByText(/quiet period/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(WAKE_HINT_AFTER_MS);
    });
    expect(
      screen.getByText(
        "The first search after a quiet period starts the pipeline's data service, which takes up to about 15 seconds.",
      ),
    ).toBeInTheDocument();
  });
});
