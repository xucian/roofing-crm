import type { PermitSummary, PropertySummary } from '@roofing-crm/pipeline-client';
import { SNAPSHOT_TEXT_MAX, type LeadPermitSnapshot, type LeadSnapshot } from '@roofing-crm/shared';

/** Third-party text is cut to the snapshot's bounds, never refused (docs/decisions.md §5). */
export function clip(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * The contractor as the permit prints it: the person's name, else the company's (some permits print
 * only the company). Null when the permit prints neither.
 */
export function printedContractor(permit: PermitSummary): string | null {
  const names = [permit.contractor?.printed_name, permit.contractor?.company_name];
  const name = names.map((value) => value?.trim() ?? '').find((value) => value !== '');
  return clip(name, SNAPSHOT_TEXT_MAX.name);
}

/** The permit fields a lead keeps: status, open duration, contractor as printed, BBB as reported. */
export function permitSnapshot(
  permit: PermitSummary,
  basis: LeadPermitSnapshot['basis'],
): LeadPermitSnapshot {
  return {
    permit_id: permit.permit_id,
    basis,
    status_group: permit.status_group,
    status: clip(permit.status, SNAPSHOT_TEXT_MAX.status) ?? '',
    roof_work_class: permit.roof_work_class,
    open_since: clip(permit.open_since, SNAPSHOT_TEXT_MAX.short),
    open_duration_days: permit.open_duration_days,
    days_since_expiry: permit.days_since_expiry,
    contractor_name: printedContractor(permit),
    bbb_status: permit.contractor ? permit.bbb.status : null,
    bbb_rating: permit.contractor ? clip(permit.bbb.rating, SNAPSHOT_TEXT_MAX.short) : null,
  };
}

/**
 * The lead's snapshot: the property's address, position and roof age, its roofing permit counts,
 * and one permit (the saved one, or the property's longest-open roofing permit), with the pipeline
 * run it was read from. For display and for F4's filters; the pipeline stays the source of truth.
 */
export function buildSnapshot(input: {
  property: PropertySummary;
  permit: LeadPermitSnapshot | null;
  runId: string;
  takenAt: Date;
}): LeadSnapshot {
  const { property } = input;
  return {
    taken_at: input.takenAt.toISOString(),
    run_id: clip(input.runId, SNAPSHOT_TEXT_MAX.name) ?? '',
    address: {
      line1: clip(property.address.line1, SNAPSHOT_TEXT_MAX.name),
      city: clip(property.address.city, SNAPSHOT_TEXT_MAX.short),
      zip: clip(property.address.zip, SNAPSHOT_TEXT_MAX.short),
    },
    lat: property.lat,
    lon: property.lon,
    roof_age_years: property.roof_age_years,
    roof_year: property.roof_year,
    roof_age_basis: property.roof_age_basis,
    roofing_permit_counts: { ...property.roofing_permit_counts },
    permit: input.permit,
  };
}
