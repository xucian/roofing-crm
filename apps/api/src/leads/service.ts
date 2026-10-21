import type { Logger } from '@aws-lambda-powertools/logger';
import {
  PipelineError,
  describePipelineError,
  longestOpenRoofingPermit,
  type PermitSummary,
  type PipelineClient,
  type PropertySummary,
} from '@roofing-crm/pipeline-client';
import {
  LeadSchema,
  isRoofJobLead,
  leadKey,
  matchesLeadFilter,
  type CreateLeadResult,
  type CreateManyLeadsResult,
  type CreateManyRowResult,
  type DeleteLeadResult,
  type Lead,
  type LeadFailure,
  type LeadFilter,
  type LeadPage,
  type LeadSnapshot,
  type LeadStatus,
  type UpdateLeadResult,
} from '@roofing-crm/shared';
import { MIN_CALL_MS, DEADLINE_RESERVE_MS, type Deadline } from '../deadline';
import { METRIC } from '../metric-names';
import type { RequestMetrics } from '../observability';
import { DeadlineExceeded } from '../pipeline';
import type { LeadRepository } from './repository';
import { buildSnapshot, permitSnapshot } from './snapshot';

/** An edit named a lead the workspace does not have (deleted, or never saved). */
export class LeadNotFound extends Error {
  override readonly name = 'LeadNotFound';
}

/** One row could not be saved; `create` throws it, `createMany` reports it in the row. */
export class LeadRowFailure extends Error {
  override readonly name = 'LeadRowFailure';
  constructor(readonly failure: LeadFailure) {
    super(failure.message);
  }
}

export interface LeadServiceDeps {
  repository: LeadRepository;
  pipeline: PipelineClient;
  deadline: Deadline;
  metrics: RequestMetrics;
  logger: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  newId: () => string;
}

export interface LeadService {
  create(input: {
    workspace_id: string;
    property_id: string;
    permit_id: string;
  }): Promise<CreateLeadResult>;
  createMany(input: {
    workspace_id: string;
    rows: { property_id: string; permit_id: string }[];
  }): Promise<CreateManyLeadsResult>;
  list(input: {
    workspace_id: string;
    cursor?: string | null | undefined;
    limit: number;
    filter?: LeadFilter | undefined;
  }): Promise<LeadPage>;
  update(input: {
    workspace_id: string;
    property_id: string;
    permit_id: string;
    status?: LeadStatus | undefined;
    note?: string | undefined;
  }): Promise<UpdateLeadResult>;
  delete(input: {
    workspace_id: string;
    property_id: string;
    permit_id: string;
  }): Promise<DeleteLeadResult>;
}

interface Ref {
  property_id: string;
  permit_id: string;
}

const DIMENSIONS = { operation: 'create' } as const;

/** The permits a property embeds; the permit search reads as many when the list is truncated. */
const EMBEDDED_PERMITS = 50;

/**
 * The permit a property lead keeps: its longest-open roof job with no completed date (the long-open
 * lead rule, `isRoofJobLead`), else its longest-open open or stalled roofing permit.
 */
function leadPermit(permits: readonly PermitSummary[]): PermitSummary | null {
  return (
    longestOpenRoofingPermit(permits.filter(isRoofJobLead)) ?? longestOpenRoofingPermit(permits)
  );
}

/** What a log line may say about a filter: its fields, never the point of a radius (a GPS fix). */
export function describeFilter(filter: LeadFilter | undefined): Record<string, unknown> | null {
  if (!filter) return null;
  const { within, ...rest } = filter;
  return { ...rest, ...(within ? { within_miles: within.radius_miles } : {}) };
}

/**
 * Saving leads (README AC 8, the creating half). Per row: an existing lead is returned as it is, with
 * no pipeline call; otherwise the function reads `/v1/meta` (once per request, first, so it takes the
 * pipeline's cold start), then the permit (which embeds its property) or the property, builds the
 * snapshot and writes the lead with a conditional put. Rows run one after another, never in
 * parallel, and a row that would start after the deadline fails as `deadline` without a write, so
 * the browser can send it again.
 */
export function createLeadService(deps: LeadServiceDeps): LeadService {
  const now = deps.now ?? (() => new Date());
  let run: Promise<string> | null = null;

  // A failed /v1/meta fails the rows after it too: the pipeline is down or busy for this request.
  const runId = (): Promise<string> => {
    run ??= deps.pipeline.getMeta().then((answer) => answer.data.run.run_id);
    return run;
  };

  // Only the first 50 permits are embedded, unordered: past that, the permit search lists the
  // property's open and stalled roofing permits in the contract's order, and the same rule picks.
  const searchedLeadPermit = async (propertyId: string): Promise<PermitSummary | null> => {
    const { data } = await deps.pipeline.searchPermits({
      property_id: propertyId,
      status_group: ['open', 'stalled'],
      roofing_only: true,
      limit: EMBEDDED_PERMITS,
    });
    return leadPermit(data.items);
  };

  const readSnapshot = async (ref: Ref): Promise<LeadSnapshot> => {
    const currentRun = await runId();
    if (ref.permit_id !== '') {
      const { data: permit } = await deps.pipeline.getPermit(ref.permit_id);
      if (permit.property_id !== ref.property_id) {
        throw new LeadRowFailure({
          code: 'mismatch',
          message: `Permit ${ref.permit_id} belongs to property ${permit.property_id}, not ${ref.property_id}.`,
          pipeline_request_id: null,
        });
      }
      const property: PropertySummary =
        permit.property ?? (await deps.pipeline.getProperty(permit.property_id)).data;
      return buildSnapshot({
        property,
        permit: permitSnapshot(permit, 'saved'),
        runId: currentRun,
        takenAt: now(),
      });
    }

    const { data: property } = await deps.pipeline.getProperty(ref.property_id);
    const lead = property.permits_truncated
      ? await searchedLeadPermit(property.property_id)
      : leadPermit(property.permits);
    return buildSnapshot({
      property,
      permit: lead ? permitSnapshot(lead, 'longest_open') : null,
      runId: currentRun,
      takenAt: now(),
    });
  };

  const failureOf = (error: unknown): LeadFailure => {
    if (error instanceof LeadRowFailure) return error.failure;
    if (error instanceof DeadlineExceeded || deps.deadline.signal.aborted) {
      return {
        code: 'deadline',
        message: 'The request ran out of time before this row. Nothing was saved; try it again.',
        pipeline_request_id: error instanceof PipelineError ? (error.requestId ?? null) : null,
      };
    }
    if (error instanceof PipelineError) {
      return {
        code: error.kind === 'http' && error.status === 404 ? 'not_found' : 'pipeline',
        message: describePipelineError(error),
        pipeline_request_id: error.requestId ?? null,
      };
    }
    throw error;
  };

  const createOne = async (workspaceId: string, ref: Ref): Promise<CreateManyRowResult> => {
    const key = leadKey(ref);
    const existing = await deps.repository.get(workspaceId, key);
    if (existing) {
      deps.metrics.count(METRIC.leadProcessed, DIMENSIONS);
      deps.logger.info('lead exists', { ...ref, lead_id: existing.lead_id, outcome: 'existing' });
      return { ...ref, outcome: 'existing', lead: existing };
    }

    let snapshot: LeadSnapshot;
    try {
      if (deps.deadline.remainingMs() - DEADLINE_RESERVE_MS < MIN_CALL_MS) {
        throw new DeadlineExceeded(key);
      }
      snapshot = await readSnapshot(ref);
    } catch (error) {
      const failure = failureOf(error);
      deps.metrics.count(METRIC.leadFailed, { ...DIMENSIONS, reason: failure.code });
      deps.logger.warn('lead not saved', {
        ...ref,
        outcome: 'failed',
        reason: failure.code,
        pipeline_request_id: failure.pipeline_request_id,
      });
      return { ...ref, outcome: 'failed', error: failure };
    }

    const at = now().toISOString();
    const lead: Lead = LeadSchema.parse({
      lead_id: deps.newId(),
      property_id: ref.property_id,
      permit_id: ref.permit_id,
      status: 'new',
      note: '',
      snapshot,
      created_at: at,
      updated_at: at,
    });
    const put = await deps.repository.putNew(workspaceId, lead);
    const outcome = put.created ? 'created' : 'existing';
    deps.metrics.count(METRIC.leadProcessed, DIMENSIONS);
    deps.logger.info(put.created ? 'lead created' : 'lead exists', {
      ...ref,
      lead_id: put.lead.lead_id,
      outcome,
      run_id: snapshot.run_id,
    });
    return { ...ref, outcome, lead: put.lead };
  };

  return {
    async create(input) {
      const row = await createOne(input.workspace_id, input);
      if (row.outcome === 'failed') throw new LeadRowFailure(row.error);
      return { outcome: row.outcome, lead: row.lead };
    },

    async createMany(input) {
      // A row listed twice is saved once; both places report the same result.
      const done = new Map<string, CreateManyRowResult>();
      for (const ref of input.rows) {
        const key = leadKey(ref);
        if (!done.has(key)) done.set(key, await createOne(input.workspace_id, ref));
      }
      return {
        rows: input.rows.map((ref) => {
          const row = done.get(leadKey(ref));
          if (!row) throw new Error(`no result for ${leadKey(ref)}`);
          return row;
        }),
      };
    },

    async list(input) {
      const { filter } = input;
      const listed = await deps.repository.list(
        input.workspace_id,
        input.cursor ?? null,
        input.limit,
        filter ? (lead) => matchesLeadFilter(lead, filter) : undefined,
      );
      deps.logger.info('leads listed', {
        filter: describeFilter(filter),
        returned: listed.items.length,
        scanned: listed.scanned,
        has_more: listed.next_cursor !== null,
      });
      return { items: listed.items, next_cursor: listed.next_cursor };
    },

    async update(input) {
      const ref = { property_id: input.property_id, permit_id: input.permit_id };
      const lead = await deps.repository.update(
        input.workspace_id,
        leadKey(ref),
        { status: input.status, note: input.note },
        now().toISOString(),
      );
      if (!lead) {
        deps.logger.info('lead not updated', { ...ref, outcome: 'missing' });
        throw new LeadNotFound('This workspace has no such lead: it was deleted, or never saved.');
      }
      deps.metrics.count(METRIC.leadProcessed, { operation: 'update' });
      // Which fields changed and the new status; the note itself is never logged.
      deps.logger.info('lead updated', {
        ...ref,
        lead_id: lead.lead_id,
        fields: [
          input.status === undefined ? null : 'status',
          input.note === undefined ? null : 'note',
        ].filter((field) => field !== null),
        status: lead.status,
        note_length: lead.note.length,
      });
      return { lead };
    },

    async delete(input) {
      const ref = { property_id: input.property_id, permit_id: input.permit_id };
      const deleted = await deps.repository.delete(input.workspace_id, leadKey(ref));
      const outcome = deleted ? 'deleted' : 'missing';
      deps.metrics.count(METRIC.leadProcessed, { operation: 'delete' });
      deps.logger.info(deleted ? 'lead deleted' : 'lead not deleted', {
        ...ref,
        lead_id: deleted?.lead_id ?? null,
        outcome,
      });
      return { outcome };
    },
  };
}
