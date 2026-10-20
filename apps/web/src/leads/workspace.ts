import { ULID_PATTERN, ulid } from '@roofing-crm/shared';

const STORAGE_KEY = 'roofing-crm.workspace';

/**
 * This browser's workspace (docs/decisions.md, metagross entry): a ULID kept in local storage and
 * sent with every lead call, so a visitor sees their own leads after a reload. It partitions, it
 * does not authenticate; clearing site data starts a new workspace.
 */
export interface Workspace {
  id: string;
  /** False when the browser refuses local storage: the leads last only as long as this page. */
  persistent: boolean;
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadWorkspace(storage: Storage | null = localStorageOrNull()): Workspace {
  try {
    const stored = storage?.getItem(STORAGE_KEY) ?? null;
    if (stored !== null && ULID_PATTERN.test(stored)) return { id: stored, persistent: true };
    const id = ulid();
    if (storage === null) return { id, persistent: false };
    storage.setItem(STORAGE_KEY, id);
    return { id, persistent: true };
  } catch {
    return { id: ulid(), persistent: false };
  }
}
