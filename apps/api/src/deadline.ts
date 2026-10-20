/**
 * Every request gets 25 s (docs/decisions.md, metagross entry): under the Lambda's 29 s timeout and
 * API Gateway's 30 s integration cap, so the function always answers, with what it finished, before
 * either cuts it off.
 */
export const HANDLER_DEADLINE_MS = 25_000;

/** Kept free at the end of the budget for the DynamoDB write and the response. */
export const DEADLINE_RESERVE_MS = 1_500;

/** A pipeline call is not started with less time left than this. */
export const MIN_CALL_MS = 1_000;

export interface Deadline {
  /** Milliseconds left before the request must answer. */
  remainingMs(): number;
  /** Aborts when the budget runs out, cutting short a back-off or a call in flight. */
  signal: AbortSignal;
}

/**
 * The request's budget: 25 s from its start, or less when the Lambda itself has less time left
 * (`getRemainingTimeInMillis`, minus the reserve).
 */
export function startDeadline(
  lambdaRemainingMs: number | undefined,
  now: () => number = Date.now,
): Deadline {
  const budget = Math.min(
    HANDLER_DEADLINE_MS,
    lambdaRemainingMs === undefined ? HANDLER_DEADLINE_MS : lambdaRemainingMs - DEADLINE_RESERVE_MS,
  );
  const endsAt = now() + Math.max(0, budget);
  return {
    remainingMs: () => Math.max(0, endsAt - now()),
    signal: AbortSignal.timeout(Math.max(0, budget)),
  };
}
