import {
  describeCrmApiError,
  type CrmApiClient,
  type CrmApiFailure,
} from '@roofing-crm/api-client';
import {
  CREATE_MANY_MAX,
  LEAD_LIST_PAGE,
  leadKey,
  type Lead,
  type LeadFailure,
  type LeadFilter,
  type LeadStatus,
} from '@roofing-crm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatLeadAddress } from './format-lead';
import type { Workspace } from './workspace';

/** A row to save: a property, or one of its permits. */
export interface LeadTarget {
  property_id: string;
  permit_id: string;
  /** For the save report: what the person saw, e.g. the address. */
  label: string;
}

/** Leads are read whole, a page at a time, up to this many pages (2,000 leads). */
export const MAX_LIST_PAGES = 10;

export type LeadsView =
  | { status: 'loading' }
  | { status: 'ready'; leads: Lead[]; requestId: string | null; truncated: boolean }
  | { status: 'failed'; error: CrmApiFailure };

/** The leads `leads.list` returned for the Leads page's filters; `off` without filters. */
export type FilteredLeadsView =
  | { status: 'off' }
  | { status: 'loading' }
  | {
      status: 'ready';
      leads: Lead[];
      filter: LeadFilter;
      requestId: string | null;
      truncated: boolean;
    }
  | { status: 'failed'; error: CrmApiFailure };

interface FilterAnswer {
  key: string;
  attempt: number;
  view: Extract<FilteredLeadsView, { status: 'ready' | 'failed' }>;
}

/** Wait this long after the last change to a filter before reading the list. */
export const FILTER_DEBOUNCE_MS = 300;

/** How an edit or a delete went, for the lead's card. */
export type EditOutcome = { ok: true; requestId: string } | { ok: false; error: CrmApiFailure };

export interface LeadPatch {
  status?: LeadStatus;
  note?: string;
}

/** A change the page reports above the list, since its card is gone: a delete. */
export interface LeadsNotice {
  text: string;
  requestId: string | null;
}

/** Where a save started, so only that page reports it: the map (its list or drawer) or an answer. */
export type SaveOrigin = 'map' | 'assistant';

export interface SaveReport {
  /** Increases with every save, so the panel can tell reports apart. */
  id: number;
  origin: SaveOrigin;
  created: LeadTarget[];
  existing: LeadTarget[];
  failed: { target: LeadTarget; failure: LeadFailure }[];
  /** The whole request failed (nothing is known about its rows). */
  error: CrmApiFailure | null;
  /** The CRM request id of the save, which finds it in the `leads` function's logs. */
  requestId: string | null;
  /** What was asked, for "Try again". */
  targets: LeadTarget[];
}

export interface LeadsStore {
  workspace: Workspace;
  view: LeadsView;
  /** `leadKey`s of the saved leads, for the "Saved" marks. */
  savedKeys: ReadonlySet<string>;
  /** `leadKey`s in a save that has not answered yet. */
  savingKeys: ReadonlySet<string>;
  lastSave: SaveReport | null;
  save: (targets: LeadTarget[], origin?: SaveOrigin) => void;
  dismissSave: () => void;
  reload: () => void;
  /** The filtered list, when the page asked for one. */
  filtered: FilteredLeadsView;
  reloadFiltered: () => void;
  /** Sets a lead's status or note; edits run one after another, in the order made. */
  update: (lead: Lead, patch: LeadPatch) => Promise<EditOutcome>;
  remove: (lead: Lead) => Promise<EditOutcome>;
  notice: LeadsNotice | null;
  dismissNotice: () => void;
}

const byNewest = (a: Lead, b: Lead): number =>
  a.created_at < b.created_at
    ? 1
    : a.created_at > b.created_at
      ? -1
      : leadKey(a) < leadKey(b)
        ? -1
        : 1;

function merge(leads: Lead[], added: Lead[]): Lead[] {
  const known = new Map(leads.map((lead) => [leadKey(lead), lead]));
  for (const lead of added) known.set(leadKey(lead), lead);
  return [...known.values()].sort(byNewest);
}

/** Every lead of the workspace that the filter keeps, newest first, up to MAX_LIST_PAGES pages. */
async function readLeads(
  client: CrmApiClient,
  workspaceId: string,
  filter: LeadFilter | null,
): Promise<{ leads: Lead[]; requestId: string | null; truncated: boolean }> {
  const leads: Lead[] = [];
  let cursor: string | null = null;
  let requestId: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const answer = await client.leads.list.query({
      workspace_id: workspaceId,
      cursor,
      limit: LEAD_LIST_PAGE.max,
      ...(filter ? { filter } : {}),
    });
    leads.push(...answer.items);
    requestId = answer.request_id;
    cursor = answer.next_cursor;
    if (cursor === null) break;
  }
  return { leads: merge([], leads), requestId, truncated: cursor !== null };
}

/**
 * The workspace's leads (README AC 8): read from the CRM API when the page opens, so they survive a
 * reload; saved one or many at a time; edited, deleted and filtered on the Leads page. Saves run one
 * after another, as the pipeline's account needs (one pipeline call at a time), and each reports its
 * rows as created, already saved or failed. Edits and deletes have their own queue, so a long save
 * does not hold them up. The filter is applied by the `leads` function (`leads.list`); an edit or a
 * delete updates both the whole list and the filtered one.
 */
export function useLeads(
  client: CrmApiClient,
  workspace: Workspace,
  filter: LeadFilter | null = null,
): LeadsStore {
  const [view, setView] = useState<LeadsView>({ status: 'loading' });
  const [answer, setAnswer] = useState<FilterAnswer | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [lastSave, setLastSave] = useState<SaveReport | null>(null);
  const [notice, setNotice] = useState<LeadsNotice | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filterAttempt, setFilterAttempt] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const edits = useRef<Promise<unknown>>(Promise.resolve());
  const reports = useRef(0);
  // The filter's identity changes on every render of the page; its JSON does not.
  const filterKey = filter === null ? null : JSON.stringify(filter);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setView({ status: 'loading' });
      try {
        const read = await readLeads(client, workspace.id, null);
        if (!cancelled) setView({ status: 'ready', ...read });
      } catch (error) {
        if (!cancelled) setView({ status: 'failed', error: describeCrmApiError(error) });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, workspace.id, attempt]);

  // The filtered read's answer, for the filter key and attempt it was read for. "Off" and
  // "loading" follow from the current key, so the effect never sets state before it reads.
  useEffect(() => {
    if (filterKey === null) return;
    const active = JSON.parse(filterKey) as LeadFilter;
    const read = { key: filterKey, attempt: filterAttempt };
    let cancelled = false;
    const timer = setTimeout(() => {
      readLeads(client, workspace.id, active).then(
        (answer) => {
          if (!cancelled)
            setAnswer({ ...read, view: { status: 'ready', filter: active, ...answer } });
        },
        (error: unknown) => {
          if (!cancelled) {
            setAnswer({ ...read, view: { status: 'failed', error: describeCrmApiError(error) } });
          }
        },
      );
    }, FILTER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, workspace.id, filterKey, filterAttempt]);

  // While a read is pending no list shows, so the page's count and its cards are always one answer.
  const filtered: FilteredLeadsView =
    filterKey === null
      ? { status: 'off' }
      : answer?.key === filterKey && answer.attempt === filterAttempt
        ? answer.view
        : { status: 'loading' };

  /** Applies a change to every list on the page: the whole one and the filtered one. */
  const patchLists = useCallback((change: (leads: Lead[]) => Lead[]): void => {
    setView((current) =>
      current.status === 'ready' ? { ...current, leads: change(current.leads) } : current,
    );
    setAnswer((current) =>
      current?.view.status === 'ready'
        ? { ...current, view: { ...current.view, leads: change(current.view.leads) } }
        : current,
    );
  }, []);

  const enqueueEdit = useCallback((task: () => Promise<EditOutcome>): Promise<EditOutcome> => {
    const result = edits.current.then(task);
    edits.current = result.catch(() => undefined);
    return result;
  }, []);

  const update = useCallback(
    (lead: Lead, patch: LeadPatch): Promise<EditOutcome> =>
      enqueueEdit(async () => {
        const key = leadKey(lead);
        try {
          const answer = await client.leads.update.mutate({
            workspace_id: workspace.id,
            property_id: lead.property_id,
            permit_id: lead.permit_id,
            ...patch,
          });
          patchLists((leads) => leads.map((item) => (leadKey(item) === key ? answer.lead : item)));
          return { ok: true, requestId: answer.request_id };
        } catch (error) {
          const failure = describeCrmApiError(error);
          // The function's own NOT_FOUND: the lead was deleted elsewhere, e.g. in another tab.
          if (failure.code === 'NOT_FOUND') {
            patchLists((leads) => leads.filter((item) => leadKey(item) !== key));
            setNotice({
              text: `The lead for ${formatLeadAddress(lead)} was deleted elsewhere, so it has left the list.`,
              requestId: failure.requestId,
            });
          }
          return { ok: false, error: failure };
        }
      }),
    [client, workspace.id, enqueueEdit, patchLists],
  );

  const remove = useCallback(
    (lead: Lead): Promise<EditOutcome> =>
      enqueueEdit(async () => {
        const key = leadKey(lead);
        try {
          const answer = await client.leads.delete.mutate({
            workspace_id: workspace.id,
            property_id: lead.property_id,
            permit_id: lead.permit_id,
          });
          patchLists((leads) => leads.filter((item) => leadKey(item) !== key));
          setNotice({
            text:
              answer.outcome === 'deleted'
                ? `Deleted the lead for ${formatLeadAddress(lead)}.`
                : `The lead for ${formatLeadAddress(lead)} was deleted already.`,
            requestId: answer.request_id,
          });
          return { ok: true, requestId: answer.request_id };
        } catch (error) {
          return { ok: false, error: describeCrmApiError(error) };
        }
      }),
    [client, workspace.id, enqueueEdit, patchLists],
  );

  const savedKeys = useMemo(
    () => new Set(view.status === 'ready' ? view.leads.map((lead) => leadKey(lead)) : []),
    [view],
  );

  const run = useCallback(
    async (targets: LeadTarget[], origin: SaveOrigin): Promise<SaveReport> => {
      const report: SaveReport = {
        id: (reports.current += 1),
        origin,
        created: [],
        existing: [],
        failed: [],
        error: null,
        requestId: null,
        targets,
      };
      const saved: Lead[] = [];
      try {
        if (targets.length === 1 && targets[0]) {
          const [target] = targets;
          const answer = await client.leads.create.mutate({
            workspace_id: workspace.id,
            property_id: target.property_id,
            permit_id: target.permit_id,
          });
          report.requestId = answer.request_id;
          (answer.outcome === 'created' ? report.created : report.existing).push(target);
          saved.push(answer.lead);
        } else {
          for (let start = 0; start < targets.length; start += CREATE_MANY_MAX) {
            const chunk = targets.slice(start, start + CREATE_MANY_MAX);
            const answer = await client.leads.createMany.mutate({
              workspace_id: workspace.id,
              rows: chunk.map(({ property_id, permit_id }) => ({ property_id, permit_id })),
            });
            report.requestId = answer.request_id;
            answer.rows.forEach((row, index) => {
              const target = chunk[index];
              if (!target) return;
              if (row.outcome === 'failed') {
                report.failed.push({ target, failure: row.error });
              } else {
                (row.outcome === 'created' ? report.created : report.existing).push(target);
                saved.push(row.lead);
              }
            });
          }
        }
      } catch (error) {
        const failure = describeCrmApiError(error);
        report.error = failure;
        report.requestId = failure.requestId;
        if (targets.length === 1 && targets[0] && failure.failure) {
          report.error = null;
          report.failed.push({ target: targets[0], failure: failure.failure });
        }
      }
      if (saved.length > 0) {
        setView((current) =>
          current.status === 'ready' ? { ...current, leads: merge(current.leads, saved) } : current,
        );
      }
      return report;
    },
    [client, workspace.id],
  );

  const save = useCallback(
    (targets: LeadTarget[], origin: SaveOrigin = 'map'): void => {
      if (targets.length === 0) return;
      const keys = targets.map((target) => leadKey(target));
      setSaving((current) => new Set([...current, ...keys]));
      queue.current = queue.current.then(async () => {
        const report = await run(targets, origin);
        setLastSave(report);
        setSaving((current) => {
          const next = new Set(current);
          for (const key of keys) next.delete(key);
          return next;
        });
      });
    },
    [run],
  );

  return {
    workspace,
    view,
    savedKeys,
    savingKeys: saving,
    lastSave,
    save,
    dismissSave: () => {
      setLastSave(null);
    },
    reload: () => {
      setAttempt((n) => n + 1);
    },
    filtered,
    reloadFiltered: () => {
      setFilterAttempt((n) => n + 1);
    },
    update,
    remove,
    notice,
    dismissNotice: () => {
      setNotice(null);
    },
  };
}
