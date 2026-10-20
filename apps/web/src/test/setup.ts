import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout, so no scrollIntoView; the app calls it to bring a save report into view.
Element.prototype.scrollIntoView = function scrollIntoView() {
  return undefined;
};

afterEach(() => {
  cleanup();
});
