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
} from '@roofing-crm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export interface SaveReport {
  /** Increases with every save, so the panel can tell reports apart. */
  id: number;
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
  save: (targets: LeadTarget[]) => void;
  dismissSave: () => void;
  reload: () => void;
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

/**
 * The workspace's leads (README AC 8, creating): read from the CRM API when the page opens, so they
 * survive a reload, and saved one or many at a time. Saves run one after another, as the pipeline's
 * account needs (one pipeline call at a time), and each reports its rows as created, already saved
 * or failed.
 */
export function useLeads(client: CrmApiClient, workspace: Workspace): LeadsStore {
  const [view, setView] = useState<LeadsView>({ status: 'loading' });
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [lastSave, setLastSave] = useState<SaveReport | null>(null);
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const reports = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setView({ status: 'loading' });
      const leads: Lead[] = [];
      let cursor: string | null = null;
      let requestId: string | null = null;
      try {
        for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
          const answer = await client.leads.list.query({
            workspace_id: workspace.id,
            cursor,
            limit: LEAD_LIST_PAGE.max,
          });
          leads.push(...answer.items);
          requestId = answer.request_id;
          cursor = answer.next_cursor;
          if (cursor === null) break;
        }
        if (!cancelled) {
          setView({
            status: 'ready',
            leads: merge([], leads),
            requestId,
            truncated: cursor !== null,
          });
        }
      } catch (error) {
        if (!cancelled) setView({ status: 'failed', error: describeCrmApiError(error) });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, workspace.id, attempt]);

  const savedKeys = useMemo(
    () => new Set(view.status === 'ready' ? view.leads.map((lead) => leadKey(lead)) : []),
    [view],
  );

  const run = useCallback(
    async (targets: LeadTarget[]): Promise<SaveReport> => {
      const report: SaveReport = {
        id: (reports.current += 1),
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
    (targets: LeadTarget[]): void => {
      if (targets.length === 0) return;
      const keys = targets.map((target) => leadKey(target));
      setSaving((current) => new Set([...current, ...keys]));
      queue.current = queue.current.then(async () => {
        const report = await run(targets);
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
  };
}
