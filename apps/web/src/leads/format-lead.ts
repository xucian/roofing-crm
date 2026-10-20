import {
  formatDays,
  type Lead,
  type LeadPermitSnapshot,
  type LeadStatus,
} from '@roofing-crm/shared';
import { ROOF_WORK_CLASS_LABELS, STATUS_GROUP_LABELS } from '../details/format-permit';
import { formatAddress } from '../results/format-property';
import type { RoofWorkClass } from '@roofing-crm/pipeline-client';

export const LEAD_STATUS_LABELS: Readonly<Record<LeadStatus, string>> = {
  new: 'New',
  working: 'Working',
  closed: 'Closed',
};

/** The address the snapshot recorded. */
export function formatLeadAddress(lead: Lead): string {
  return formatAddress(lead.snapshot.address);
}

/** "Open 5.5 years, since 2021-04-01" or "Was open 2.5 years, expired 30 days ago"; null otherwise. */
export function formatSnapshotDuration(permit: LeadPermitSnapshot): string | null {
  const days = permit.open_duration_days;
  if (days === null) return null;
  const since = permit.open_since ? `, since ${permit.open_since}` : '';
  if (permit.status_group === 'open') return `Open ${formatDays(days)}${since}`;
  if (permit.status_group !== 'stalled') return null;
  const ago =
    permit.days_since_expiry === null
      ? ''
      : `, expired ${formatDays(permit.days_since_expiry)} ago`;
  return `Was open ${formatDays(days)}${since}${ago}`;
}

/** The permit line's label: the saved permit, or the property's longest-open one. */
export function formatSnapshotPermitBasis(permit: LeadPermitSnapshot): string {
  return permit.basis === 'saved'
    ? `Permit ${permit.permit_id}`
    : `Longest-open roofing permit ${permit.permit_id}`;
}

export function formatSnapshotPermitStatus(permit: LeadPermitSnapshot): string {
  const work =
    permit.roof_work_class in ROOF_WORK_CLASS_LABELS
      ? ROOF_WORK_CLASS_LABELS[permit.roof_work_class as RoofWorkClass]
      : permit.roof_work_class;
  return `${STATUS_GROUP_LABELS[permit.status_group]} · ${work} · printed status “${permit.status}”`;
}

const BBB_LABELS = {
  available: 'BBB rated',
  unavailable: 'No BBB profile',
  blocked: 'BBB blocked at source',
} as const;

/** BBB as the snapshot recorded it; null when the permit printed no contractor. */
export function formatSnapshotBbb(permit: LeadPermitSnapshot): string | null {
  if (permit.bbb_status === null) return null;
  if (permit.bbb_status === 'available' && permit.bbb_rating) return `BBB ${permit.bbb_rating}`;
  return BBB_LABELS[permit.bbb_status];
}

/** A link that opens the lead's property on the map, around its snapshot position. */
export function leadMapLink(lead: Lead): string {
  const params = new URLSearchParams();
  if (lead.snapshot.lat !== null && lead.snapshot.lon !== null) {
    params.set('lat', lead.snapshot.lat.toFixed(5));
    params.set('lon', lead.snapshot.lon.toFixed(5));
    params.set('radius', '1');
  }
  params.set('property', lead.property_id);
  return `/?${params.toString()}`;
}
