import {
  PipelineError,
  comparePermits,
  describePipelineError,
  type Meta,
  type PermitSummary,
  type PipelineClient,
} from '@roofing-crm/pipeline-client';
import {
  LEAD_LIST_PAGE,
  LeadFilterSchema,
  PropertyIdSchema,
  RADIUS_MILES,
  ROOF_JOB_CLASSES,
  leadKey,
  type ChatLeadCreated,
  type ChatOfferedLead,
} from '@roofing-crm/shared';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { LeadRowFailure, type LeadService } from '../leads/service';
import { DeadlineExceeded } from '../pipeline';
import type { EvidenceCollector } from './evidence';
import type { CenterPoint, CoordinateGuard } from './guard';
import {
  projectCenters,
  projectContractor,
  projectLeads,
  projectPermit,
  projectPermitPage,
  projectProperty,
  projectPropertyPage,
  projectRun,
} from './projection';

/** One `tool_calls[]` item of the response, plus the timing the log line carries. */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error' | 'rate_limited' | 'timeout';
  total: number | null;
  returned: number | null;
  result_summary: string;
  ms: number;
}

/** The agent's page sizes, the pipeline MCP's: 20 by default, at most 50. */
export const AGENT_LIMIT = { default: 20, max: 50 } as const;
/** Permits a property read shows the model, roofing first in the permit search's order. */
export const PROPERTY_PERMITS_SHOWN = 20;
/** Leads one turn may save: each reads the pipeline for its snapshot. */
export const MAX_LEADS_PER_TURN = 5;

// Input schemas: the pipeline's frozen MCP registry (descriptions and bounds), docs/decisions.md
// 2026-10-17 sync entry. `limit` 20, at most 50; `open_permits` required.
const limit = z
  .int()
  .min(1)
  .max(AGENT_LIMIT.max)
  .default(AGENT_LIMIT.default)
  .describe(`Page size, 1 to ${String(AGENT_LIMIT.max)}, default ${String(AGENT_LIMIT.default)}.`);
const cursor = z
  .string()
  .optional()
  .describe('Opaque cursor from a previous response of the same search.');
const lat = z
  .number()
  .min(-90)
  .max(90)
  .optional()
  .describe('WGS84 latitude; give together with lon. Omit both for a county-wide search.');
const lon = z
  .number()
  .min(-180)
  .max(180)
  .optional()
  .describe('WGS84 longitude; give together with lat.');
const radius = z
  .number()
  .min(RADIUS_MILES.min)
  .max(RADIUS_MILES.max)
  .default(RADIUS_MILES.default)
  .describe('Great-circle miles, 0.1 to 25, default 5.');
const statusGroup = z.enum(['open', 'stalled', 'closed', 'needs_review']);
/** The contract's roof work classes, in its order; the first four are the roofing set. */
const roofWorkClass = z.enum([
  'primary_roof_replacement',
  'primary_roof_new_construction',
  'repair_or_coating',
  'accessory_roof',
  'other',
  'needs_review',
]);

const INPUTS = {
  resolve_search_center: z.object({
    q: z.string().min(1).max(100).describe('City name, alias or ZIP.'),
  }),
  search_properties: z.object({
    lat,
    lon,
    radius_miles: radius,
    roof_age_min: z
      .int()
      .min(0)
      .default(15)
      .describe('Strict: matches roof_age_years > roof_age_min. 0 omits the age clause.'),
    open_permits: z
      .boolean()
      .describe(
        'Required, no default: also match properties with an open or stalled roofing permit.',
      ),
    long_open_years: z
      .number()
      .positive()
      .default(5)
      .describe('Long-open threshold in years (open_duration_days >= long_open_years x 365).'),
    owner_tenure_min: z
      .number()
      .min(0)
      .optional()
      .describe('Years since the deed date; narrows the match.'),
    absentee_owner: z.boolean().optional().describe('Narrow to absentee owners.'),
    out_of_area_owner: z.boolean().optional().describe('Narrow to out-of-area owners.'),
    limit,
    cursor,
  }),
  get_property: z.object({
    property_id: PropertyIdSchema.describe('TCAD PROP_ID as printed.'),
  }),
  search_permits: z
    .object({
      lat,
      lon,
      radius_miles: radius,
      status_group: z
        .array(statusGroup)
        .min(1)
        .default(['open', 'stalled'])
        .describe('Status groups to include, default open and stalled.'),
      roofing_only: z
        .boolean()
        .default(true)
        .describe('Only permits whose roof_work_class is in the roofing set.'),
      roof_work_class: z
        .array(roofWorkClass)
        .min(1)
        .optional()
        .describe(
          'Restrict to these roof work classes. Left out on an area search for open or stalled roofing permits, roof jobs only: primary_roof_replacement and repair_or_coating. Every roofing class: primary_roof_replacement, primary_roof_new_construction, repair_or_coating, accessory_roof.',
        ),
      min_open_years: z
        .number()
        .min(0)
        .optional()
        .describe('Only permits open at least this many years (open_duration_days).'),
      contractor_attribution_key: z
        .string()
        .optional()
        .describe('Permits grouped under one printed contractor name and phone.'),
      property_id: z.string().optional().describe('All permits of one property.'),
      limit,
      cursor,
    })
    // Leads are roof jobs: a search for open or stalled roofing permits by area keeps them unless the
    // model names classes; one property's or one contractor's permits keep every class. Named
    // classes are put in the contract's order, so the recorded call is the same however they came.
    .transform(({ roof_work_class: named, ...input }) => {
      const searchesLeads =
        input.roofing_only &&
        input.property_id === undefined &&
        input.contractor_attribution_key === undefined &&
        input.status_group.every((group) => group === 'open' || group === 'stalled');
      return {
        ...input,
        roof_work_class: named
          ? roofWorkClass.options.filter((value) => named.includes(value))
          : searchesLeads
            ? [...ROOF_JOB_CLASSES]
            : undefined,
      };
    }),
  search_permit_text: z.object({
    q: z
      .string()
      .min(1)
      .max(200)
      .describe('Plain words, at most 200 characters; stopwords are dropped, aliases applied.'),
    match: z
      .enum(['all', 'any'])
      .default('all')
      .describe('all: every remaining query term must match.'),
    lat,
    lon,
    radius_miles: radius,
    status_group: z
      .array(statusGroup)
      .min(1)
      .default(['open', 'stalled', 'closed', 'needs_review'])
      .describe('Status groups to include, default all four.'),
    roofing_only: z
      .boolean()
      .default(false)
      .describe('Only permits whose roof_work_class is in the roofing set.'),
    limit,
    cursor,
  }),
  get_permit: z.object({
    permit_id: z.string().min(1).max(64).describe('Permit number as printed (contains a space).'),
  }),
  get_contractor: z.object({ contractor_attribution_key: z.string().min(1).max(64) }),
  get_run_summary: z.object({}),
  list_leads: LeadFilterSchema,
  create_lead: z.object({
    property_id: PropertyIdSchema.describe('A property_id a tool returned in this turn.'),
    permit_id: z
      .string()
      .max(64)
      .default('')
      .describe('Empty for a property lead; else one of its permits a tool returned in this turn.'),
  }),
} as const;

type ToolName = keyof typeof INPUTS;
/** Each tool's input as its schema parses it, defaults applied. */
type ToolInputs = { [N in ToolName]: z.output<(typeof INPUTS)[N]> };
/** The schemas by tool, so one generic registration hands each tool its own input type. */
const SCHEMAS: { [N in ToolName]: z.ZodType<ToolInputs[N]> } = INPUTS;

/** The pipeline MCP registry's frozen descriptions, plus the CRM's lead tools. */
const DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  resolve_search_center:
    'Resolve a Travis County city, alias or ZIP to a centroid. Call it first when a question names a place; never pass coordinates it did not return or the user did not type.',
  search_properties:
    'Properties within a radius by roof age, open roofing permits and owner signals. `open_permits` is required: a property matches when its roof is older than `roof_age_min` **or**, if `open_permits` is true, it has an open or stalled roofing permit.',
  get_property: `One property with its permits: at most ${String(PROPERTY_PERMITS_SHOWN)}, roofing first and longest open first, with permits_total; page the rest with search_permits and property_id.`,
  search_permits:
    'Permits within a radius, or of one `property_id`, by status group, roofing class and years open, longest-open first.',
  search_permit_text:
    'Free-text search over building-permit descriptions. A hit is roofing only if its `roof_work_class` is in the roofing set.',
  get_permit: 'One permit with its property, contractor attribution and BBB status.',
  get_contractor:
    'Permits grouped under one printed contractor name and phone; an attribution, not a verified identity.',
  get_run_summary: 'The current run, counts, CIDs and limitations.',
  list_leads:
    "The user's saved leads in this CRM workspace, newest first, filtered on each lead's saved snapshot: statuses, roof older than roof_age_min (strict), permit_groups (open, stalled, closed, needs_review, none), open_years_min, and within a radius of a point.",
  create_lead:
    "Save a property, or one of its permits, as a lead in the user's workspace (the CRM reads its snapshot from the pipeline). Only when the user explicitly asks to save in this message, and only with ids a tool returned in this turn. Saving one twice returns the existing lead.",
};

/** Verbs that save on their own: "save the first two", "bookmark it". */
const SAVE_VERB = /\b(save|bookmark)\b/i;
/** What a save points at: leads, the CRM, or the results ("them", "the first two", "both"). */
const SAVE_OBJECT =
  /\b(leads?|crm|them|these|those|it|this|that|all|both|each|first|second|third|top|last|\d+)\b/i;
/** Verbs that save only with leads, the CRM or the user's list: "add them to my list", not "add 2 miles". */
const LIST_VERB = /\b(add|create|put|store|track)\b/i;
const LIST_OBJECT = /\b(leads?|crm|my list)\b/i;
const NEGATED =
  /\b(don'?t|do not|never|no need to|without|not)\s+(?:\w+\s+){0,3}?(save|add|create|store|put|bookmark|track)\b/i;

/**
 * Whether the user asked to save leads in the latest message, not negated: "save" or "bookmark"
 * pointing at leads or at the results ("save the first two"), or "add", "create", "put", "store" or
 * "track" with leads, the CRM or "my list" ("add them to my list"; alakazam review finding 3). A
 * bare "yes" is never an ask: the page's Save button saves what an answer offers.
 */
export function asksToSaveLeads(messages: readonly { role: string; content: string }[]): boolean {
  const latest = messages.at(-1);
  if (latest?.role !== 'user') return false;
  const text = latest.content;
  if (NEGATED.test(text)) return false;
  return (
    (SAVE_VERB.test(text) && SAVE_OBJECT.test(text)) ||
    (LIST_VERB.test(text) && LIST_OBJECT.test(text))
  );
}

/**
 * The records an answer's SAVE_OFFER line offers, kept when a tool returned them in this turn and
 * the answer cites them: a property, or a pipeline permit with its property. At most
 * MAX_LEADS_PER_TURN; the page saves them with its Save button.
 */
export function offeredLeads(
  tokens: readonly { kind: string; id: string }[],
  evidence: EvidenceCollector,
  cited: readonly { kind: string; id: string }[],
): ChatOfferedLead[] {
  const leads = new Map<string, ChatOfferedLead>();
  for (const { kind, id } of tokens) {
    if (!cited.some((token) => token.kind === kind && token.id === id)) continue;
    let lead: ChatOfferedLead | null = null;
    if (kind === 'property' && evidence.has('property', id)) {
      lead = { property_id: id, permit_id: '' };
    } else if (kind === 'permit') {
      const permit = evidence.items.find((item) => item.kind === 'permit' && item.permit_id === id);
      if (permit?.property_id) lead = { property_id: permit.property_id, permit_id: id };
    }
    if (lead) leads.set(leadKey(lead), lead);
  }
  return [...leads.values()].slice(0, MAX_LEADS_PER_TURN);
}

/** Drops a trailing Texas suffix ("Pflugerville, TX"): search centers are Travis County names. */
export function stripStateSuffix(q: string): string {
  const match = /^(.*?[^\s,])\s*(?:,\s*|\s+)(?:tx|texas)\.?\s*$/i.exec(q.trim());
  return match?.[1] ?? q;
}

export interface TurnToolsOptions {
  pipeline: PipelineClient;
  leads: LeadService;
  workspaceId: string;
  meta: Meta;
  evidence: EvidenceCollector;
  guard: CoordinateGuard;
  /** The latest message asks to save leads (asksToSaveLeads over the conversation). */
  saveRequested: boolean;
  remainingMs: () => number;
  log: (record: ToolCallRecord) => void;
}

/** The search centers, the map's pin and the roof work classes the turn's searches used. */
export interface ToolsUsed {
  centers: CenterPoint[];
  pin: boolean;
  roofWorkClasses: string[][];
}

interface Failure {
  error: string;
  detail?: string;
  request_id?: string | null;
}

/** A failed call as the model sees it: never a throw, always with the pipeline's request id. */
function callFailure(error: unknown): { status: ToolCallRecord['status']; result: Failure } {
  if (error instanceof DeadlineExceeded) {
    return { status: 'timeout', result: { error: 'timeout', detail: 'the turn ran out of time' } };
  }
  if (error instanceof LeadRowFailure) {
    return {
      status: error.failure.code === 'deadline' ? 'timeout' : 'error',
      result: {
        error: error.failure.code,
        detail: error.failure.message,
        request_id: error.failure.pipeline_request_id,
      },
    };
  }
  if (error instanceof PipelineError) {
    const status =
      error.kind === 'throttled' ? 'rate_limited' : error.kind === 'timeout' ? 'timeout' : 'error';
    return {
      status,
      result: {
        error: error.kind === 'http' ? `http_${String(error.status ?? 0)}` : error.kind,
        detail: describePipelineError(error),
        request_id: error.requestId ?? null,
      },
    };
  }
  // Anything else (a DynamoDB failure in a lead tool): recorded, never handed to the model raw.
  return {
    status: 'error',
    result: {
      error: 'internal',
      detail: `the CRM could not complete this call (${error instanceof Error ? error.name : 'unknown'})`,
    },
  };
}

/** A pipeline 404 on a single-record read: the id is not in this dataset, a clear miss. */
const isNotFound = (error: unknown): boolean =>
  error instanceof PipelineError && error.kind === 'http' && error.status === 404;

const pageSummary = (answer: { total: number; items: unknown[]; area_note?: string | null }) =>
  `${String(answer.total)} matches, ${String(answer.items.length)} returned${answer.area_note ? `; ${answer.area_note}` : ''}`;

/** Roofing permits first, each group in the permit search's order (open, stalled, …; longest open). */
export function propertyPermits(permits: PermitSummary[]): PermitSummary[] {
  return [...permits]
    .sort((a, b) => Number(b.is_roofing) - Number(a.is_roofing) || comparePermits(a, b))
    .slice(0, PROPERTY_PERMITS_SHOWN);
}

/**
 * The agent's tools for one turn (docs/decisions.md §6, alakazam items 18 and 19): eight over the
 * pipeline API v1 through the typed client (one at a time, inside the turn's deadline) and the two
 * lead tools over the `leads` service. A failure is a result carrying the pipeline's request id, never
 * a throw. Each call is one log line: tool, parameters, counts, latency.
 */
export function buildTurnTools(options: TurnToolsOptions) {
  const records: ToolCallRecord[] = [];
  const used: ToolsUsed = { centers: [], pin: false, roofWorkClasses: [] };
  const leadsCreated: ChatLeadCreated[] = [];
  const notes: string[] = [];
  const { pipeline, evidence, guard } = options;

  /** A single-record read; a 404 is a clear miss (null), recorded so the answer may name the id. */
  const lookup = async <T>(
    kind: 'property' | 'permit' | 'contractor',
    id: string,
    call: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await call();
    } catch (error) {
      if (!isNotFound(error)) throw error;
      evidence.addMissing(kind, id);
      return null;
    }
  };
  const missingRecord = (kind: string, id: string) => ({
    result: { found: false, detail: `No ${kind} ${id} in this dataset (outcome no_matches).` },
    summary: `not found: ${kind} ${id}`,
    total: 0,
    returned: 0,
  });

  type Run<N extends ToolName> = (
    input: ToolInputs[N],
    callId: string,
  ) => Promise<{ result: unknown; summary: string; total: number | null; returned: number | null }>;

  const run: { [N in ToolName]: Run<N> } = {
    resolve_search_center: async (input, callId) => {
      const q = stripStateSuffix(input.q);
      if (q !== input.q) {
        notes.push(`State suffix dropped from the place name: "${input.q}" → "${q}".`);
      }
      const { data } = await pipeline.searchCenters(q);
      guard.addCenters(data.items);
      evidence.addCenters(callId, data.items);
      return {
        result: projectCenters(data.items),
        summary:
          data.items.length === 0
            ? 'no search center matches'
            : `${String(data.items.length)} search centers: ${data.items
                .slice(0, 3)
                .map((c) => `${c.name} (${c.kind}, ${c.match_type})`)
                .join(', ')}`,
        total: data.items.length,
        returned: data.items.length,
      };
    },
    search_properties: async (input, callId) => {
      const { data } = await pipeline.searchProperties(input);
      evidence.addProperties(callId, data.items);
      return {
        result: projectPropertyPage(data),
        summary: pageSummary(data),
        total: data.total,
        returned: data.items.length,
      };
    },
    get_property: async (input, callId) => {
      const id = input.property_id;
      const answer = await lookup('property', id, () => pipeline.getProperty(id));
      if (!answer) return missingRecord('property', id);
      const { data } = answer;
      const permits = propertyPermits(data.permits);
      evidence.addProperty(callId, data, permits);
      return {
        result: projectProperty(data, permits),
        summary: `property ${data.property_id} with ${String(permits.length)} of ${String(data.permits_total)} permits`,
        total: null,
        returned: null,
      };
    },
    search_permits: async (input, callId) => {
      const { data } = await pipeline.searchPermits(input);
      if (input.roof_work_class) used.roofWorkClasses.push(input.roof_work_class);
      evidence.addPermits(callId, data.items);
      return {
        result: projectPermitPage(data),
        summary: pageSummary(data),
        total: data.total,
        returned: data.items.length,
      };
    },
    search_permit_text: async (input, callId) => {
      const { data } = await pipeline.searchPermitText(input);
      evidence.addPermits(callId, data.items);
      return {
        result: projectPermitPage(data),
        summary: pageSummary(data),
        total: data.total,
        returned: data.items.length,
      };
    },
    get_permit: async (input, callId) => {
      const id = input.permit_id;
      const answer = await lookup('permit', id, () => pipeline.getPermit(id));
      if (!answer) return missingRecord('permit', id);
      const { data } = answer;
      evidence.addPermit(callId, data, data.property ?? null);
      return {
        result: projectPermit(data),
        summary: `permit ${data.permit_id} (${data.status_group})`,
        total: null,
        returned: null,
      };
    },
    get_contractor: async (input, callId) => {
      const id = input.contractor_attribution_key;
      const answer = await lookup('contractor', id, () => pipeline.getContractor(id));
      if (!answer) return missingRecord('contractor', id);
      const { data } = answer;
      evidence.addContractor(callId, data);
      return {
        result: projectContractor(data),
        summary: `contractor ${data.contractor_attribution_key}: ${String(data.permit_count)} permits`,
        total: null,
        returned: null,
      };
    },
    // The turn read /v1/meta first; the summary is that answer, without another call.
    get_run_summary: (_, callId) => {
      evidence.addRun(callId, options.meta);
      return Promise.resolve({
        result: projectRun(options.meta),
        summary: `run ${options.meta.run.run_id}`,
        total: null,
        returned: null,
      });
    },
    list_leads: async (input, callId) => {
      const page = await options.leads.list({
        workspace_id: options.workspaceId,
        limit: LEAD_LIST_PAGE.max,
        filter: input,
      });
      const shown = page.items.slice(0, AGENT_LIMIT.max);
      evidence.addLeads(callId, shown);
      return {
        result: projectLeads(shown, page.items.length),
        summary: `${String(page.items.length)} leads${page.next_cursor ? ' (more not read)' : ''}`,
        total: page.items.length,
        returned: shown.length,
      };
    },
    create_lead: async (input, callId) => {
      const ref = { property_id: input.property_id, permit_id: input.permit_id };
      const { outcome, lead } = await options.leads.create({
        workspace_id: options.workspaceId,
        ...ref,
      });
      leadsCreated.push({ lead_id: lead.lead_id, ...ref, outcome });
      evidence.addLeads(callId, [lead]);
      return {
        result: { outcome, lead_id: lead.lead_id, ...ref },
        summary: `lead ${outcome}: property ${ref.property_id}${ref.permit_id ? `, permit ${ref.permit_id}` : ''}`,
        total: null,
        returned: null,
      };
    },
  };

  /** The search-center rule, for the point of a search or of a lead filter's radius. */
  const checkPoint = (point: { lat?: number | undefined; lon?: number | undefined }) => {
    const checked = guard.check(point.lat, point.lon);
    if (!checked.ok) return checked.detail;
    if (checked.center) used.centers.push(checked.center);
    if (checked.pin) used.pin = true;
    return null;
  };

  /** The lead-creation rules: an explicit ask in this message, the cap, ids from this turn. */
  const checkSave = (input: ToolInputs['create_lead']) => {
    if (!options.saveRequested) {
      return 'not_requested: save a lead only when the user explicitly asks to save in this message; a "yes" is not one: point the user to the Save button, or ask them to say "save … as leads"';
    }
    if (leadsCreated.length >= MAX_LEADS_PER_TURN) {
      return `too_many: at most ${String(MAX_LEADS_PER_TURN)} leads per message; ask the user to save the rest in another message`;
    }
    if (!evidence.has('property', input.property_id)) {
      return `unknown_id: no tool returned property ${input.property_id} in this turn`;
    }
    if (input.permit_id && !evidence.has('permit', input.permit_id)) {
      return `unknown_id: no tool returned permit ${input.permit_id} in this turn`;
    }
    return null;
  };

  /** Refusals decided before any call: the search-center rule and the lead-creation rules. */
  const refuse: { [N in ToolName]?: (input: ToolInputs[N]) => string | null } = {
    search_properties: checkPoint,
    search_permits: checkPoint,
    search_permit_text: checkPoint,
    list_leads: (input) => (input.within ? checkPoint(input.within) : null),
    create_lead: checkSave,
  };

  // One call at a time, in the order the model made them (alakazam F5 review item 5): the AI SDK
  // runs a step's calls together, but the pipeline's account takes one call at a time and the
  // lead cap must see each save before the next.
  let queue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  };

  // Each tool's schema parses its input; execute receives that tool's own input type.
  const register = <N extends ToolName>(name: N) =>
    tool({
      description: DESCRIPTIONS[name],
      inputSchema: SCHEMAS[name],
      execute: (input, { toolCallId }) =>
        oneAtATime(async () => {
          const started = performance.now();
          const finish = (
            status: ToolCallRecord['status'],
            summary: string,
            counts: { total: number | null; returned: number | null } = {
              total: null,
              returned: null,
            },
          ): void => {
            const entry: ToolCallRecord = {
              id: toolCallId,
              name,
              args: input,
              status,
              ...counts,
              result_summary: summary,
              ms: Math.round(performance.now() - started),
            };
            records.push(entry);
            options.log(entry);
          };
          const refusal = refuse[name]?.(input) ?? null;
          if (refusal !== null) {
            finish('error', refusal);
            return { error: refusal.slice(0, refusal.indexOf(':')), detail: refusal };
          }
          if (options.remainingMs() <= 0) {
            finish('timeout', 'the turn deadline was reached before the call');
            return { error: 'timeout', detail: 'the turn deadline was reached' };
          }
          try {
            // Each tool adds its full records to the evidence; the model gets the projection.
            const answer = await run[name](input, toolCallId);
            finish('ok', answer.summary, { total: answer.total, returned: answer.returned });
            return answer.result;
          } catch (error) {
            const failed = callFailure(error);
            finish(failed.status, `${failed.result.error}: ${failed.result.detail ?? ''}`);
            return failed.result;
          }
        }),
    });

  // Registered explicitly, every tool once (build-ai-agents: no dynamic tool discovery).
  const tools = {
    resolve_search_center: register('resolve_search_center'),
    search_properties: register('search_properties'),
    get_property: register('get_property'),
    search_permits: register('search_permits'),
    search_permit_text: register('search_permit_text'),
    get_permit: register('get_permit'),
    get_contractor: register('get_contractor'),
    get_run_summary: register('get_run_summary'),
    list_leads: register('list_leads'),
    create_lead: register('create_lead'),
  } satisfies Record<ToolName, ToolSet[string]>;
  return { tools, records, used, leadsCreated, notes };
}

/** What buildTurnTools returns: the tool registry and what the turn's calls recorded. */
export type TurnTools = ReturnType<typeof buildTurnTools>;
/** The registry's inferred type: each tool keeps its own input type, never widened to ToolSet. */
export type TurnToolSet = TurnTools['tools'];

/**
 * The tools the model is offered: create_lead only when the latest message asks to save, so a "yes"
 * or a follow-up cannot even try a save; the Save button saves offered records. The SDK refuses a
 * call to a tool it did not offer before it runs, and create_lead keeps its own check as well.
 */
export function offeredToolNames(
  tools: TurnToolSet,
  saveRequested: boolean,
): (keyof TurnToolSet)[] {
  const names = Object.keys(tools) as (keyof TurnToolSet)[];
  return saveRequested ? names : names.filter((name) => name !== 'create_lead');
}
