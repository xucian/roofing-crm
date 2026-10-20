import {
  LeadFilterSchema,
  leadKey,
  matchesLeadFilter,
  type Lead,
  type LeadFailure,
} from '@roofing-crm/shared';

// An in-memory stand-in for the CRM API (`/api/trpc/*`) in the web tests: it keeps leads per
// workspace like the `leads` function, so a test can save, render the app again and see them.
// Snapshots are synthetic ("FIXTURE" addresses), never county data.

export interface CrmCall {
  procedure: string;
  input: Record<string, unknown>;
}

interface Row {
  property_id: string;
  permit_id?: string;
}

export interface FakeCrm {
  handle: (url: URL, init: RequestInit | undefined) => Promise<Response>;
  calls: CrmCall[];
  leads: (workspace: string) => Lead[];
  /** Stores a lead as if it had been saved earlier. */
  put: (workspace: string, lead: Lead) => void;
  /** Makes these rows fail as the function would report them. */
  failRows: Map<string, LeadFailure>;
}

let requests = 0;

export function fixtureLead(row: Row, n: number): Lead {
  const number = /^fx-(\d+)$/.exec(row.property_id)?.[1] ?? '0';
  const at = new Date(Date.UTC(2026, 9, 20, 12, 0, n)).toISOString();
  const permitId = row.permit_id ?? '';
  return {
    lead_id: `01JBQ8${String(n).padStart(20, '0')}`,
    property_id: row.property_id,
    permit_id: permitId,
    status: 'new',
    note: '',
    snapshot: {
      taken_at: at,
      run_id: 'fixture-run',
      address: { line1: `${number} FIXTURE ST`, city: 'TESTVILLE', zip: '00000' },
      lat: 30.25,
      lon: -97.75,
      roof_age_years: 36,
      roof_year: 1990,
      roof_age_basis: 'year_built',
      roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
      permit: {
        permit_id: permitId === '' ? 'FX-1 BP' : permitId,
        basis: permitId === '' ? 'longest_open' : 'saved',
        status_group: 'open',
        status: 'Active',
        roof_work_class: 'primary_roof_replacement',
        open_since: '2021-04-01',
        open_duration_days: 2000,
        days_since_expiry: null,
        contractor_name: 'FIXTURE ROOFER',
        bbb_status: 'blocked',
        bbb_rating: null,
      },
    },
    created_at: at,
    updated_at: at,
  };
}

const ok = (data: unknown, requestId: string): Response =>
  Response.json({ result: { data } }, { headers: { 'x-request-id': requestId } });

const notFound = (message: string, requestId: string): Response =>
  Response.json(
    {
      error: {
        message,
        code: -32004,
        data: { code: 'NOT_FOUND', httpStatus: 404, requestId, failure: null },
      },
    },
    { status: 404, headers: { 'x-request-id': requestId } },
  );

export function fakeCrm(): FakeCrm {
  const store = new Map<string, Map<string, Lead>>();
  const calls: CrmCall[] = [];
  const failRows = new Map<string, LeadFailure>();
  let created = 0;

  const workspace = (id: string): Map<string, Lead> => {
    let leads = store.get(id);
    if (!leads) store.set(id, (leads = new Map<string, Lead>()));
    return leads;
  };

  const createRow = (id: string, row: Row) => {
    const key = leadKey(row);
    const failure = failRows.get(key);
    if (failure) return { outcome: 'failed' as const, error: failure };
    const existing = workspace(id).get(key);
    if (existing) return { outcome: 'existing' as const, lead: existing };
    const lead = fixtureLead(row, (created += 1));
    workspace(id).set(key, lead);
    return { outcome: 'created' as const, lead };
  };

  const handle = async (url: URL, init: RequestInit | undefined): Promise<Response> => {
    const procedure = url.pathname.replace('/api/trpc/', '');
    const requestId = `crm-req-${String((requests += 1))}`;
    const input = (
      init?.method === 'POST'
        ? JSON.parse(typeof init.body === 'string' ? init.body : '{}')
        : JSON.parse(url.searchParams.get('input') ?? '{}')
    ) as Record<string, unknown>;
    calls.push({ procedure, input });
    const id = String(input.workspace_id);

    switch (procedure) {
      case 'leads.list': {
        const filter = input.filter === undefined ? null : LeadFilterSchema.parse(input.filter);
        const items = [...workspace(id).values()].filter(
          (lead) => filter === null || matchesLeadFilter(lead, filter),
        );
        return ok({ items, next_cursor: null, request_id: requestId }, requestId);
      }
      case 'leads.update': {
        const key = leadKey(input as unknown as Row);
        const lead = workspace(id).get(key);
        if (!lead) return notFound('This workspace has no such lead.', requestId);
        const updated: Lead = {
          ...lead,
          ...(input.status === undefined ? {} : { status: input.status as Lead['status'] }),
          ...(input.note === undefined ? {} : { note: input.note as string }),
          updated_at: '2026-10-21T09:00:00.000Z',
        };
        workspace(id).set(key, updated);
        return ok({ lead: updated, request_id: requestId }, requestId);
      }
      case 'leads.delete': {
        const deleted = workspace(id).delete(leadKey(input as unknown as Row));
        return ok({ outcome: deleted ? 'deleted' : 'missing', request_id: requestId }, requestId);
      }
      case 'leads.create': {
        const row = createRow(id, input as unknown as Row);
        if (row.outcome === 'failed') {
          return Response.json(
            {
              error: {
                message: row.error.message,
                code: -32004,
                data: { code: 'NOT_FOUND', httpStatus: 404, requestId, failure: row.error },
              },
            },
            { status: 404, headers: { 'x-request-id': requestId } },
          );
        }
        return ok({ ...row, request_id: requestId }, requestId);
      }
      case 'leads.createMany': {
        const rows = (input.rows as Row[]).map((row) => ({
          property_id: row.property_id,
          permit_id: row.permit_id ?? '',
          ...createRow(id, row),
        }));
        return ok({ rows, request_id: requestId }, requestId);
      }
      default:
        return Promise.resolve(
          Response.json({ error: { message: 'no such procedure' } }, { status: 404 }),
        );
    }
  };

  return {
    handle,
    calls,
    failRows,
    leads: (id) => [...workspace(id).values()],
    put: (id, lead) => {
      workspace(id).set(leadKey(lead), lead);
    },
  };
}
