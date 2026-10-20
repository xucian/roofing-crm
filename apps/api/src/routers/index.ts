import { router } from '../trpc';
import { leadsRouter } from './leads';

export const appRouter = router({
  leads: leadsRouter,
});

/** The CRM API's type, for `@roofing-crm/api-client`. */
export type AppRouter = typeof appRouter;
