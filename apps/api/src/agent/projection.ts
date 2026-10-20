import type {
  Contractor,
  Meta,
  PermitDetail,
  PermitSummary,
  PropertyDetail,
  PropertySummary,
  SearchCenter,
} from '@roofing-crm/pipeline-client';
import { leadPermitGroup, type Lead } from '@roofing-crm/shared';
import { addressLabel, firstText } from './evidence';
import { sanitizeDeep, sanitizeText } from './sanitize';

/**
 * What the model sees of each tool result (alakazam item 9, as in the pipeline agent): ids, CIDs,
 * signals and the source URL; long text cut and every string sanitized. Never the owner's name or
 * mailing address: tenure, absentee and out-of-area stay. The contractor as printed on a public
 * permit (name, company, trade, phone) is a business record and stays. Full records go to the
 * evidence, not to the model.
 */

/** Description length in a list (a single permit gets the full cap). */
export const LIST_TEXT_MAX = 300;

const nonEmpty = <T>(items: T[] | null | undefined): T[] | undefined =>
  items && items.length > 0 ? items : undefined;

function property(p: PropertySummary): Record<string, unknown> {
  return {
    property_id: p.property_id,
    geo_id: p.geo_id,
    address: addressLabel(p.address),
    year_built: p.year_built,
    roof_age_years: p.roof_age_years,
    roof_year: p.roof_year,
    roof_age_basis: p.roof_age_basis,
    roof_age_confidence: p.roof_age_confidence,
    roof_age_caveats: nonEmpty(p.roof_age_caveats),
    roofing_permit_counts: p.roofing_permit_counts,
    owner_tenure_years: p.owner_tenure_years,
    owner_absentee: p.owner_absentee,
    owner_out_of_area: p.owner_out_of_area,
    distance_miles: p.distance_miles,
    match_reasons: p.match_reasons,
    record_cid: p.record_cid,
    source_url: p.source.url,
  };
}

function permit(p: PermitSummary, textMax: number): Record<string, unknown> {
  const contractor = p.contractor;
  return {
    permit_id: p.permit_id,
    property_id: p.property_id,
    permit_class: p.permit_class,
    work_class: p.work_class,
    description: p.description ? sanitizeText(p.description, textMax) : p.description,
    roof_work_class: p.roof_work_class,
    status: p.status,
    status_group: p.status_group,
    issued_date: p.issued_date,
    expires_date: p.expires_date,
    completed_date: p.completed_date,
    open_since: p.open_since,
    open_duration_days: p.open_duration_days,
    open_duration_as_of: p.open_duration_as_of,
    days_since_expiry: p.days_since_expiry,
    contractor: contractor
      ? {
          contractor_attribution_key: contractor.contractor_attribution_key,
          company_name: firstText(contractor.company_name),
          printed_name: firstText(contractor.printed_name),
          trade: firstText(contractor.trade),
          phone: firstText(contractor.phone),
        }
      : null,
    bbb_status: p.bbb.status,
    distance_miles: p.distance_miles,
    match_snippet: p.match_snippet?.text,
    record_cid: p.record_cid,
    source_url: p.source.url,
  };
}

/** Drops null fields of a list item (a missing field reads as unknown) to keep the page small. */
const compact = (item: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== null && value !== undefined),
  );

function page<T>(
  answer: { items: T[]; total: number; next_cursor: string | null; area_note?: string | null },
  item: (record: T) => Record<string, unknown>,
) {
  const items = answer.items.map((record) => compact(item(record)));
  // A source URL shared by every item (the appraisal roll for properties) is given once.
  const urls = new Set(items.map((entry) => entry.source_url));
  const shared = items.length > 1 && urls.size === 1 ? items[0]?.source_url : undefined;
  return {
    total: answer.total,
    returned: items.length,
    area_note: answer.area_note ?? null,
    has_more: answer.next_cursor !== null,
    ...(shared ? { source_url: shared } : {}),
    items: shared
      ? items.map((item) =>
          Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'source_url')),
        )
      : items,
  };
}

/**
 * The server's reading of a resolve_search_center result, next to the items (as in the pipeline
 * agent): ask when only non-exact centers come back; no match is a place outside Travis County.
 */
export function centerGuidance(items: SearchCenter[]): string {
  if (items.length === 0) {
    return 'No Travis County search center matches this name: the place is outside Travis County (outcome out_of_county), unless it is a misspelling to ask about.';
  }
  const exact = items.filter((center) => center.match_type === 'exact');
  if (exact.length === 0) {
    return 'Only prefix or alias matches: do not search and do not resolve another name in their place; ask the user which place they meant, naming the candidates (outcome needs_clarification). Searches around these centers are refused.';
  }
  const best = exact.reduce((a, b) => (b.parcel_count > a.parcel_count ? b : a));
  const bigger = items.find(
    (center) => center !== best && center.parcel_count >= 10 * Math.max(1, best.parcel_count),
  );
  if (best.parcel_count < 50 && bigger) {
    return `The exact match ${best.name} has only ${String(best.parcel_count)} parcels while ${bigger.name} has ${String(bigger.parcel_count)}: ask which one the user meant (outcome needs_clarification).`;
  }
  return `Use ${best.name} (${best.kind}, exact match, ${String(best.parcel_count)} parcels).`;
}

export function projectCenters(items: SearchCenter[]): unknown {
  return sanitizeDeep({ items, guidance: centerGuidance(items) });
}

export function projectPropertyPage(answer: {
  items: PropertySummary[];
  total: number;
  next_cursor: string | null;
  area_note?: string | null;
}): unknown {
  return sanitizeDeep(page(answer, property));
}

export function projectPermitPage(answer: {
  items: PermitSummary[];
  total: number;
  next_cursor: string | null;
  area_note?: string | null;
}): unknown {
  return sanitizeDeep(page(answer, (record) => permit(record, LIST_TEXT_MAX)));
}

export function projectProperty(detail: PropertyDetail, permits: PermitSummary[]): unknown {
  return sanitizeDeep({
    ...compact(property(detail)),
    owner: detail.owner
      ? {
          deed_date: detail.owner.deed_date,
          owner_tenure_years: detail.owner.owner_tenure_years,
          owner_absentee: detail.owner.owner_absentee,
          owner_out_of_area: detail.owner.owner_out_of_area,
        }
      : null,
    permits_total: detail.permits_total,
    permits_shown: permits.length,
    permits: permits.map((record) => compact(permit(record, LIST_TEXT_MAX))),
  });
}

export function projectPermit(detail: PermitDetail): unknown {
  return sanitizeDeep({
    ...compact(permit(detail, 1000)),
    property: detail.property ? compact(property(detail.property)) : null,
  });
}

export function projectContractor(contractor: Contractor): unknown {
  return sanitizeDeep({
    contractor_attribution_key: contractor.contractor_attribution_key,
    identity_status: contractor.identity_status,
    company_name: contractor.company_name,
    printed_names: contractor.printed_names.slice(0, 5),
    trade: contractor.trade,
    phone: contractor.phone,
    permit_count: contractor.permit_count,
    open_permit_count: contractor.open_permit_count,
    roofing_permit_count: contractor.roofing_permit_count,
    needs_review_permit_count: contractor.needs_review_permit_count,
    bbb_status: contractor.bbb.status,
  });
}

export function projectRun(meta: Meta): unknown {
  const counts = meta.counts;
  return sanitizeDeep({
    county: meta.county,
    run: meta.run,
    manifest_cid: meta.manifest_cid,
    deploy_id: meta.deploy.deploy_id,
    counts: {
      properties: counts.properties,
      with_roof_age: counts.with_roof_age,
      permits: counts.permits,
      roofing_permits: counts.roofing_permits,
      open_roofing_permits: counts.open_roofing_permits,
      stalled_roofing_permits: counts.stalled_roofing_permits,
      roofing_permits_needs_review: counts.roofing_permits_needs_review,
      permit_contractor_attributions: counts.permit_contractor_attributions,
    },
    limitations: meta.limitations.map((limitation) => ({
      source: limitation.source,
      incomplete_reason: limitation.incomplete_reason,
      detail: sanitizeText(limitation.detail, 240),
    })),
  });
}

/** The workspace's leads as the model sees them: the snapshot's signals, never the note. */
export function projectLeads(leads: Lead[], total: number): unknown {
  return sanitizeDeep({
    total,
    returned: leads.length,
    items: leads.map((lead) =>
      compact({
        property_id: lead.property_id,
        permit_id: lead.permit_id || null,
        status: lead.status,
        address: addressLabel(lead.snapshot.address),
        roof_age_years: lead.snapshot.roof_age_years,
        roof_age_basis: lead.snapshot.roof_age_basis,
        permit_group: leadPermitGroup(lead),
        open_duration_days: lead.snapshot.permit?.open_duration_days ?? null,
        contractor_name: lead.snapshot.permit?.contractor_name ?? null,
        saved_at: lead.created_at,
        snapshot_run_id: lead.snapshot.run_id,
      }),
    ),
  });
}
