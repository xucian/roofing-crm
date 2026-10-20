import { initTRPC } from '@trpc/server';
import type { LeadFailure } from '@roofing-crm/shared';
import type { Context } from './context';
import { METRIC } from './metric-names';
import { LeadRowFailure } from './leads/service';

/** What every CRM API error carries besides tRPC's code (metagross item 3). */
export interface ErrorData {
  /** API Gateway's request id: the CRM log lines of this request carry it as `request_id`. */
  requestId: string | null;
  /** Why a lead could not be saved, with the pipeline's request id when a pipeline call failed. */
  failure: LeadFailure | null;
}

const t = initTRPC.context<Context>().create({
  // Never send stack traces, whatever NODE_ENV says.
  isDev: false,
  errorFormatter({ shape, error, ctx }) {
    const failure = error.cause instanceof LeadRowFailure ? error.cause.failure : null;
    const data: typeof shape.data & ErrorData = {
      ...shape.data,
      requestId: ctx?.requestId ?? null,
      failure,
    };
    return {
      ...shape,
      // An unexpected error's own message may describe internals; the request id finds it in the logs.
      message:
        error.code === 'INTERNAL_SERVER_ERROR'
          ? 'The CRM API failed unexpectedly. The request id finds it in the CRM logs.'
          : shape.message,
      data,
    };
  },
});

export const router = t.router;

/** Every procedure: its duration in ProcessingDuration, by operation (`create`, `createMany`, `list`). */
export const publicProcedure = t.procedure.use(async ({ ctx, path, next }) => {
  const started = Date.now();
  try {
    return await next();
  } finally {
    const operation = path.slice(path.lastIndexOf('.') + 1);
    ctx.metrics.milliseconds(METRIC.processingDuration, { operation }, Date.now() - started);
  }
});
