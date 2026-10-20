import {
  comparePermits,
  type Bbb,
  type PermitContractor,
  type PermitSummary,
  type RoofWorkClass,
  type StatusGroup,
} from '@roofing-crm/pipeline-client';
import { PERMIT_SIGNAL, formatDays } from '@roofing-crm/shared';

/** The contract's status groups, in the CRM's words (docs/decisions.md 2026-10-17). */
export const STATUS_GROUP_LABELS: Readonly<Record<StatusGroup, string>> = {
  open: 'Open',
  stalled: 'Stalled',
  closed: 'Closed',
  needs_review: 'Needs review',
};

/** What each group means, for the badge's title. */
export const STATUS_GROUP_HINTS: Readonly<Record<StatusGroup, string>> = {
  open: 'The permit is still open at the city.',
  stalled: 'The permit expired without a confirmed completion date.',
  closed: 'The permit was finaled, withdrawn, cancelled or expired after completion.',
  needs_review:
    'The printed status or work class is not in the pipeline’s mapping, so it never counts as open.',
};

export const ROOF_WORK_CLASS_LABELS: Readonly<Record<RoofWorkClass, string>> = {
  primary_roof_replacement: 'Roof replacement',
  primary_roof_new_construction: 'New construction with a roof',
  repair_or_coating: 'Roof repair or coating',
  accessory_roof: 'Accessory structure roof',
  other: 'Not roofing work',
  needs_review: 'Work class needs review',
};

const LINK_METHOD_LABELS: Readonly<Record<PermitSummary['property_link']['match_method'], string>> =
  {
    exact: 'the permit’s TCAD id equals the property’s geo id',
    normalized_digits: 'the permit’s TCAD id equals the geo id once non-digits are removed',
    tcad_permit_listing: 'TCAD’s own permit listing names this account',
  };

/** How the pipeline linked the permit to this property (`property_link`). */
export function formatPropertyLink(link: PermitSummary['property_link']): string {
  return `Linked because ${LINK_METHOD_LABELS[link.match_method]}.`;
}

/**
 * The permit search's order, shared with the lead snapshot (`@roofing-crm/pipeline-client`): the
 * permits embedded in a property come unordered, so the drawer sorts them the same way.
 */
export { comparePermits };

/** Roofing permits first (the lead signal), then the property's other permits, each in API order. */
export function groupPermits(permits: readonly PermitSummary[]): {
  roofing: PermitSummary[];
  other: PermitSummary[];
} {
  const sorted = [...permits].sort(comparePermits);
  return {
    roofing: sorted.filter((permit) => permit.is_roofing),
    other: sorted.filter((permit) => !permit.is_roofing),
  };
}

/** Open or stalled for at least the long-open threshold (contract "Long-open", 5 years). */
export function isLongOpen(permit: PermitSummary): boolean {
  return (
    (permit.status_group === 'open' || permit.status_group === 'stalled') &&
    permit.open_duration_days !== null &&
    permit.open_duration_days >= PERMIT_SIGNAL.longOpenYears * 365
  );
}

const OPEN_SINCE_BASIS: Readonly<Record<NonNullable<PermitSummary['open_since_basis']>, string>> = {
  issued_date: 'issued',
  applied_date: 'applied',
};

/**
 * How long the permit has been, or was, open, as the API computes it (docs/decisions.md §4):
 * "Open 44 years, since 1981-10-23 (issued)" or "Was open 5 months until it expired on
 * 2023-05-28, 3.4 years ago". Null for closed permits and those that need review.
 */
export function formatOpenDuration(permit: PermitSummary): string | null {
  const days = permit.open_duration_days;
  if (days === null) return null;
  const since =
    permit.open_since === null
      ? ''
      : `, since ${permit.open_since}${permit.open_since_basis ? ` (${OPEN_SINCE_BASIS[permit.open_since_basis]})` : ''}`;
  if (permit.status_group === 'open') return `Open ${formatDays(days)}${since}`;
  if (permit.status_group !== 'stalled') return null;
  const end =
    permit.open_duration_basis === 'expires_date' && permit.expires_date !== null
      ? ` until it expired on ${permit.expires_date}`
      : ' until its last status change';
  const ago =
    permit.days_since_expiry === null ? '' : `, ${formatDays(permit.days_since_expiry)} ago`;
  return `Was open ${formatDays(days)}${since}${end}${ago}`;
}

/** The permit's dates that are present, in lifecycle order. */
export function permitDates(permit: PermitSummary): { label: string; value: string }[] {
  const dates: { label: string; value: string | null }[] = [
    { label: 'Applied', value: permit.applied_date },
    { label: 'Issued', value: permit.issued_date },
    { label: 'Expires', value: permit.expires_date },
    { label: 'Completed', value: permit.completed_date },
  ];
  return dates.filter((date): date is { label: string; value: string } => date.value !== null);
}

/**
 * BBB as the API reports it (docs/decisions.md §4, 2026-10-17): the rating when available,
 * "No BBB profile" when the source has none, "Blocked at source" while BBB blocks scripted access.
 * Never inferred.
 */
export function formatBbb(bbb: Bbb): string {
  switch (bbb.status) {
    case 'available':
      return bbb.rating === null ? 'Rating not reported' : `Rating ${bbb.rating}`;
    case 'unavailable':
      return 'No BBB profile';
    case 'blocked':
      return 'Blocked at source';
  }
}

/** The contractor's printed fields that are present: name, company, trade, phone. */
export function contractorLines(contractor: PermitContractor): { label: string; value: string }[] {
  const lines: { label: string; value: string | null }[] = [
    { label: 'Name', value: contractor.printed_name },
    { label: 'Company', value: contractor.company_name },
    { label: 'Trade', value: contractor.trade },
    { label: 'Phone', value: contractor.phone },
  ];
  return lines.filter(
    (line): line is { label: string; value: string } =>
      line.value !== null && line.value.trim() !== '',
  );
}
