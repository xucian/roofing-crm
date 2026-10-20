import {
  CreateLeadInputSchema,
  CreateManyLeadsInputSchema,
  ListLeadsInputSchema,
} from '@roofing-crm/shared';
import { TRPCError } from '@trpc/server';
import { InvalidCursor } from '../leads/repository';
import { LeadRowFailure } from '../leads/service';
import { publicProcedure, router } from '../trpc';

const ROW_FAILURE_CODES = {
  not_found: 'NOT_FOUND',
  mismatch: 'BAD_REQUEST',
  pipeline: 'BAD_GATEWAY',
  deadline: 'GATEWAY_TIMEOUT',
} as const;

/**
 * Lead procedures (F3: the creating half of README AC 8). Each mutation has its own HTTP API route
 * and throttle (metagross item 4); the inputs are the shared Zod schemas. Every answer carries the
 * request id that finds it in the function's logs (`request_id`), as every error does.
 */
export const leadsRouter = router({
  /** Saves one property or permit as a lead; saving it again returns the existing lead. */
  create: publicProcedure.input(CreateLeadInputSchema).mutation(async ({ ctx, input }) => {
    try {
      return { ...(await ctx.leads.create(input)), request_id: ctx.requestId };
    } catch (error) {
      if (error instanceof LeadRowFailure) {
        throw new TRPCError({
          code: ROW_FAILURE_CODES[error.failure.code],
          message: error.failure.message,
          cause: error,
        });
      }
      throw error;
    }
  }),

  /** Saves up to 25 rows of a multi-selection, reporting each as created, existing or failed. */
  createMany: publicProcedure
    .input(CreateManyLeadsInputSchema)
    .mutation(async ({ ctx, input }) => ({
      ...(await ctx.leads.createMany(input)),
      request_id: ctx.requestId,
    })),

  /** The workspace's leads, by property and permit id, a page at a time. */
  list: publicProcedure.input(ListLeadsInputSchema).query(async ({ ctx, input }) => {
    try {
      return { ...(await ctx.leads.list(input)), request_id: ctx.requestId };
    } catch (error) {
      if (error instanceof InvalidCursor) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
      }
      throw error;
    }
  }),
});
