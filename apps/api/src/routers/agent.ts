import { ChatInputSchema } from '@roofing-crm/shared';
import { TRPCError } from '@trpc/server';
import { AgentUnavailable } from '../agent/errors';
import { LeadRowFailure } from '../leads/service';
import { publicProcedure, router } from '../trpc';

/**
 * The agent (README AC 9, F5): one turn of `pidgeot-agent` per call, on its own POST route, throttle
 * and function (docs/decisions.md §6). The browser holds the history and sends it whole. An answer is
 * always 200 with its outcome; 503 says why the agent refused, 502 that the pipeline did not answer.
 */
export const agentRouter = router({
  chat: publicProcedure.input(ChatInputSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.agent) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'The agent runs in its own function.' });
    }
    try {
      return await ctx.agent.chat(input);
    } catch (error) {
      if (error instanceof AgentUnavailable) {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: error.message, cause: error });
      }
      if (error instanceof LeadRowFailure) {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: error.failure.message, cause: error });
      }
      throw error;
    }
  }),
});
