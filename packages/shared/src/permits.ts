import { PERMIT_SIGNAL } from './defaults';
import { DAYS_PER_OPEN_YEAR } from './leads';

// What makes a pipeline permit a lead for a roofer, for the drawer, the agent and the lead snapshot
// alike. The field names and values are the pinned contract's (`PermitSummary`); the pipeline's
// permits are passed as they are.

/** The roof work classes of a job a roofer can bid on: a roof replacement, or a repair or coating. */
export const ROOF_JOB_CLASSES = ['primary_roof_replacement', 'repair_or_coating'] as const;

interface LeadFields {
  status_group: string;
  roof_work_class: string;
  open_duration_days: number | null;
  completed_date: string | null;
}

const isOpenOrStalled = (permit: Pick<LeadFields, 'status_group'>): boolean =>
  permit.status_group === 'open' || permit.status_group === 'stalled';

/**
 * A permit listed as open or stalled that carries a completed date: the work was finished, whatever
 * the printed status says, so it is never called open.
 */
export function hasCompletionConflict<
  T extends Pick<LeadFields, 'status_group' | 'completed_date'>,
>(permit: T): permit is T & { completed_date: string } {
  return isOpenOrStalled(permit) && permit.completed_date !== null;
}

/** An open or stalled roof job with no completed date: a permit that can be a lead. */
export function isRoofJobLead(
  permit: Pick<LeadFields, 'status_group' | 'roof_work_class' | 'completed_date'>,
): boolean {
  return (
    isOpenOrStalled(permit) &&
    permit.completed_date === null &&
    ROOF_JOB_CLASSES.some((roofJob) => roofJob === permit.roof_work_class)
  );
}

/** A lead permit open, or once open, at least PERMIT_SIGNAL.longOpenYears: the "Long-open" badge. */
export function isLongOpenLead(permit: LeadFields): boolean {
  return (
    isRoofJobLead(permit) &&
    permit.open_duration_days !== null &&
    permit.open_duration_days >= PERMIT_SIGNAL.longOpenYears * DAYS_PER_OPEN_YEAR
  );
}

/** Some permits print only part of a phone, such as the area code "512": not a number to call. */
const PHONE_MIN_DIGITS = 10;

/** The phone as the permit prints it, when it has at least 10 digits; else null. */
export function callablePhone(phone: string | null): string | null {
  return phone !== null && phone.replace(/\D/g, '').length >= PHONE_MIN_DIGITS ? phone : null;
}
