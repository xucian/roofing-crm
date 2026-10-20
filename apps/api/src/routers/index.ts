import { router } from '../trpc';
import { agentRouter } from './agent';
import { leadsRouter } from './leads';

// Both functions serve this router; API Gateway's routes decide which one answers a procedure.
// The agent's implementation reaches it through the context, so the `leads` bundle has no AI SDK.
export const appRouter = router({
  leads: leadsRouter,
  agent: agentRouter,
});

/** The CRM API's type, for `@roofing-crm/api-client`. */
export type AppRouter = typeof appRouter;
