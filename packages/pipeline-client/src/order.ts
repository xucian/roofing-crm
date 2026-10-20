import type { PermitSummary, StatusGroup } from './client';

const STATUS_ORDER: Readonly<Record<StatusGroup, number>> = {
  open: 0,
  stalled: 1,
  closed: 2,
  needs_review: 3,
};

type OrderedPermit = Pick<PermitSummary, 'permit_id' | 'status_group' | 'open_duration_days'>;

/**
 * The permit search's order (contract, `GET /v1/permits/search`): open, stalled, closed, needs
 * review; then the longest open first, unknown durations last; then the permit id. The permits
 * embedded in a property come unordered, so the drawer and the lead snapshot sort them the same way.
 */
export function comparePermits(a: OrderedPermit, b: OrderedPermit): number {
  const byStatus = STATUS_ORDER[a.status_group] - STATUS_ORDER[b.status_group];
  if (byStatus !== 0) return byStatus;
  const aDays = a.open_duration_days;
  const bDays = b.open_duration_days;
  if (aDays !== bDays) {
    if (aDays === null) return 1;
    if (bDays === null) return -1;
    return bDays - aDays;
  }
  return a.permit_id < b.permit_id ? -1 : a.permit_id > b.permit_id ? 1 : 0;
}

/** The property's lead signal: its first open or stalled roofing permit in that order, if any. */
export function longestOpenRoofingPermit<
  T extends OrderedPermit & Pick<PermitSummary, 'is_roofing'>,
>(permits: readonly T[]): T | null {
  const candidates = permits.filter(
    (permit) =>
      permit.is_roofing && (permit.status_group === 'open' || permit.status_group === 'stalled'),
  );
  return [...candidates].sort(comparePermits)[0] ?? null;
}
