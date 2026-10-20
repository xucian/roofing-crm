import { ULID_PATTERN } from '@roofing-crm/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './workspace';

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadWorkspace', () => {
  it('mints a ULID once and keeps it for the next page load', () => {
    const first = loadWorkspace(window.localStorage);
    expect(first.id).toMatch(ULID_PATTERN);
    expect(first.persistent).toBe(true);
    expect(loadWorkspace(window.localStorage)).toEqual(first);
  });

  it('replaces a stored value that is not a ULID', () => {
    window.localStorage.setItem('roofing-crm.workspace', 'tampered');
    expect(loadWorkspace(window.localStorage).id).toMatch(ULID_PATTERN);
  });

  it('still works, for this page only, when the browser refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Storage;
    const workspace = loadWorkspace(refusing);
    expect(workspace.id).toMatch(ULID_PATTERN);
    expect(workspace.persistent).toBe(false);
    expect(loadWorkspace(null).persistent).toBe(false);
  });
});
