import { z } from 'zod';
import { RADIUS_MILES } from './defaults';
import { greatCircleMiles } from './geo';
import { ULID_PATTERN } from './ulid';

// The CRM's lead records (docs/decisions.md §5 and the metagross entry). These schemas are the
// tRPC inputs and outputs, so the browser and the `leads` function validate the same shapes.

export const LEAD_STATUSES = ['new', 'working', 'closed'] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

/** At most this many rows per `leads.createMany` (one pipeline call per row, one at a time). */
export const CREATE_MANY_MAX = 25;

/** `leads.list` page size: the default and the most one page may ask for. */
export const LEAD_LIST_PAGE = { default: 100, max: 200 } as const;

/** Bounds on the free-text note. */
export const LEAD_NOTE_MAX = 2000;

/**
 * The browser's workspace: a ULID it keeps in local storage and sends with every lead call, so
 * each visitor sees only their own leads. It partitions the table; it does not authenticate.
 */
export const WorkspaceIdSchema = z.string().regex(ULID_PATTERN, 'must be a ULID');

/** A pipeline property id. `#` would make the table's sort key ambiguous, so it is refused. */
export const PropertyIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[^#\s]+$/, 'must not contain # or spaces');

/** A permit number as printed (it contains a space); empty for a property-only lead. */
export const PermitIdSchema = z
  .string()
  .trim()
  .max(64)
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  .regex(/^[^\u0000-\u001f\u007f]*$/, 'must not contain control characters');

/** What a lead is about: a property, or one of its permits. */
export const LeadRefSchema = z.object({
  property_id: PropertyIdSchema,
  permit_id: PermitIdSchema.default(''),
});
export type LeadRef = z.input<typeof LeadRefSchema>;

/** The table's sort key: `<property_id>#<permit_id>`, empty after `#` for a property-only lead. */
export function leadKey(ref: { property_id: string; permit_id?: string | undefined }): string {
  return `${ref.property_id}#${ref.permit_id ?? ''}`;
}

export const CreateLeadInputSchema = LeadRefSchema.extend({ workspace_id: WorkspaceIdSchema });
export type CreateLeadInput = z.input<typeof CreateLeadInputSchema>;

export const CreateManyLeadsInputSchema = z.object({
  workspace_id: WorkspaceIdSchema,
  rows: z.array(LeadRefSchema).min(1).max(CREATE_MANY_MAX),
});
export type CreateManyLeadsInput = z.input<typeof CreateManyLeadsInputSchema>;

/** Names one lead of the workspace: `leads.delete`, and the base of `leads.update`. */
export const LeadInWorkspaceSchema = LeadRefSchema.extend({ workspace_id: WorkspaceIdSchema });

/** Sets the lead's status, its note, or both; the snapshot never changes. */
export const UpdateLeadInputSchema = LeadInWorkspaceSchema.extend({
  status: LeadStatusSchema.optional(),
  note: z.string().max(LEAD_NOTE_MAX).optional(),
}).refine((input) => input.status !== undefined || input.note !== undefined, {
  error: 'give a status, a note or both',
});
export type UpdateLeadInput = z.input<typeof UpdateLeadInputSchema>;

export const DeleteLeadInputSchema = LeadInWorkspaceSchema;
export type DeleteLeadInput = z.input<typeof DeleteLeadInputSchema>;

// The snapshot: pipeline fields copied when the lead is created, for display and for F4's filters.
// The `leads` function reads them from the pipeline itself; it never takes them from the browser.
// Enum values mirror the pinned contract; the function's snapshot builder is type-checked against it.

const ROOF_AGE_BASES = ['completed_replacement', 'new_construction', 'year_built'] as const;
const STATUS_GROUPS = ['open', 'stalled', 'closed', 'needs_review'] as const;
const BBB_STATUSES = ['available', 'unavailable', 'blocked'] as const;

/** Third-party text kept in a snapshot is cut to these lengths, never rejected. */
export const SNAPSHOT_TEXT_MAX = { short: 64, name: 200, status: 120 } as const;

const nullableText = (max: number) => z.string().max(max).nullable();
const count = z.int().min(0);

export const LeadPermitSnapshotSchema = z.object({
  permit_id: z.string().max(64),
  /** `saved`: the lead is this permit; `longest_open`: the property's longest-open roofing permit. */
  basis: z.enum(['saved', 'longest_open']),
  status_group: z.enum(STATUS_GROUPS),
  /** The status as printed by the city. */
  status: z.string().max(SNAPSHOT_TEXT_MAX.status),
  roof_work_class: z.string().max(SNAPSHOT_TEXT_MAX.short),
  open_since: nullableText(SNAPSHOT_TEXT_MAX.short),
  open_duration_days: z.int().nullable(),
  days_since_expiry: z.int().nullable(),
  /** The contractor as printed on the permit: an attribution, not a verified identity. */
  contractor_name: nullableText(SNAPSHOT_TEXT_MAX.name),
  bbb_status: z.enum(BBB_STATUSES).nullable(),
  bbb_rating: nullableText(SNAPSHOT_TEXT_MAX.short),
});
export type LeadPermitSnapshot = z.infer<typeof LeadPermitSnapshotSchema>;

export const LeadSnapshotSchema = z.object({
  /** When the function read the pipeline, and the pipeline run it read (`/v1/meta`). */
  taken_at: z.iso.datetime(),
  run_id: z.string().max(SNAPSHOT_TEXT_MAX.name),
  address: z.object({
    line1: nullableText(SNAPSHOT_TEXT_MAX.name),
    city: nullableText(SNAPSHOT_TEXT_MAX.short),
    zip: nullableText(SNAPSHOT_TEXT_MAX.short),
  }),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  roof_age_years: z.int().nullable(),
  /** The year the roof age counts from, with its basis. */
  roof_year: z.int().nullable(),
  roof_age_basis: z.enum(ROOF_AGE_BASES).nullable(),
  roofing_permit_counts: z.object({
    open: count,
    stalled: count,
    closed: count,
    needs_review: count,
  }),
  /** The saved permit, or for a property lead its longest-open open or stalled roofing permit. */
  permit: LeadPermitSnapshotSchema.nullable(),
});
export type LeadSnapshot = z.infer<typeof LeadSnapshotSchema>;

export const LeadSchema = z.object({
  lead_id: z.string().regex(ULID_PATTERN),
  property_id: z.string().max(64),
  /** Empty for a property-only lead. */
  permit_id: z.string().max(64),
  status: LeadStatusSchema,
  note: z.string().max(LEAD_NOTE_MAX),
  snapshot: LeadSnapshotSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type Lead = z.infer<typeof LeadSchema>;

// Filters (docs/decisions.md §5): status, roof age, permit status group, open duration and a radius.
// They read the snapshot, so a lead matches as it was when saved. The `leads` function applies them
// to `leads.list` with this predicate; the browser uses the same one to mark an edited lead that
// no longer matches.

/** A lead's permit group: its snapshot permit's status group, or `none` without one. */
export const LEAD_PERMIT_GROUPS = [...STATUS_GROUPS, 'none'] as const;
export const LeadPermitGroupSchema = z.enum(LEAD_PERMIT_GROUPS);
export type LeadPermitGroup = z.infer<typeof LeadPermitGroupSchema>;

/** Years to days for the open-duration filter, as the contract's `long_open_years` counts them. */
export const DAYS_PER_OPEN_YEAR = 365;

/** Bounds of the filter's year fields, the map's roof-age range. */
export const LEAD_FILTER_YEARS = { min: 0, max: 100 } as const;

const filterYears = z.int().min(LEAD_FILTER_YEARS.min).max(LEAD_FILTER_YEARS.max);

/** Every field is optional; a missing one does not filter. An empty list matches no lead. */
export const LeadFilterSchema = z.object({
  statuses: z.array(LeadStatusSchema).max(LEAD_STATUSES.length).optional(),
  /** Strict, as on the map and in the contract: roof_age_years > roof_age_min. */
  roof_age_min: filterYears.optional(),
  permit_groups: z.array(LeadPermitGroupSchema).max(LEAD_PERMIT_GROUPS.length).optional(),
  /** The permit has been open (or was, if stalled) at least this long: days >= years x 365. */
  open_years_min: filterYears.optional(),
  /** Great-circle miles around a point, the map's pin; the radius bounds are the map's. */
  within: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      radius_miles: z.number().min(RADIUS_MILES.min).max(RADIUS_MILES.max),
    })
    .optional(),
});
export type LeadFilter = z.infer<typeof LeadFilterSchema>;

export function leadPermitGroup(lead: Lead): LeadPermitGroup {
  return lead.snapshot.permit?.status_group ?? 'none';
}

/** Whether the lead's snapshot meets every field of the filter. */
export function matchesLeadFilter(lead: Lead, filter: LeadFilter): boolean {
  const { snapshot } = lead;
  if (filter.statuses && !filter.statuses.includes(lead.status)) return false;
  if (filter.roof_age_min !== undefined) {
    if (snapshot.roof_age_years === null || snapshot.roof_age_years <= filter.roof_age_min) {
      return false;
    }
  }
  if (filter.permit_groups && !filter.permit_groups.includes(leadPermitGroup(lead))) return false;
  if (filter.open_years_min !== undefined) {
    const days = snapshot.permit?.open_duration_days ?? null;
    if (days === null || days < filter.open_years_min * DAYS_PER_OPEN_YEAR) return false;
  }
  if (filter.within) {
    if (snapshot.lat === null || snapshot.lon === null) return false;
    const miles = greatCircleMiles(filter.within, { lat: snapshot.lat, lon: snapshot.lon });
    if (miles > filter.within.radius_miles) return false;
  }
  return true;
}

/** True when no field of the filter is set, so every lead matches. */
export function isEmptyLeadFilter(filter: LeadFilter): boolean {
  return (Object.keys(filter) as (keyof LeadFilter)[]).every((key) => filter[key] === undefined);
}

export const ListLeadsInputSchema = z.object({
  workspace_id: WorkspaceIdSchema,
  cursor: z.string().max(2048).nullish(),
  limit: z.int().min(1).max(LEAD_LIST_PAGE.max).default(LEAD_LIST_PAGE.default),
  filter: LeadFilterSchema.optional(),
});
export type ListLeadsInput = z.input<typeof ListLeadsInputSchema>;

/** Why one row of a create could not be saved. */
export const LEAD_FAILURE_CODES = [
  /** The pipeline has no such property or permit (404). */
  'not_found',
  /** The permit belongs to another property than the one named. */
  'mismatch',
  /** The pipeline failed, timed out or stayed busy. */
  'pipeline',
  /** The request's time ran out before this row; nothing was written, so it can be retried. */
  'deadline',
] as const;
export type LeadFailureCode = (typeof LEAD_FAILURE_CODES)[number];

export interface LeadFailure {
  code: LeadFailureCode;
  message: string;
  /** The pipeline's request id for the call that failed, when there was one. */
  pipeline_request_id: string | null;
}

export type CreateLeadOutcome = 'created' | 'existing';

export interface CreateLeadResult {
  outcome: CreateLeadOutcome;
  lead: Lead;
}

export type CreateManyRowResult = LeadRefKey &
  ({ outcome: CreateLeadOutcome; lead: Lead } | { outcome: 'failed'; error: LeadFailure });

interface LeadRefKey {
  property_id: string;
  permit_id: string;
}

export interface CreateManyLeadsResult {
  rows: CreateManyRowResult[];
}

export interface LeadPage {
  items: Lead[];
  next_cursor: string | null;
}

export interface UpdateLeadResult {
  lead: Lead;
}

/** `missing`: there was no such lead (deleted already, e.g. in another tab); nothing changed. */
export type DeleteLeadOutcome = 'deleted' | 'missing';

export interface DeleteLeadResult {
  outcome: DeleteLeadOutcome;
}
