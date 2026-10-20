import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
import type { Context } from './context';
import { logger } from './observability';
import { appRouter } from './routers';

/** The CRM API's base path behind CloudFront's `/api/*` behaviour; fixed once deployed. */
export const TRPC_PREFIX = '/api/trpc';

/**
 * The tRPC adapter takes the procedure from the `{proxy+}` path parameter, or else from the whole
 * path, so the explicit mutation routes (`POST /api/trpc/leads.create`) need the prefix removed.
 */
export function withoutPrefix(event: APIGatewayProxyEventV2): APIGatewayProxyEventV2 {
  const rawPath = event.rawPath.startsWith(`${TRPC_PREFIX}/`)
    ? event.rawPath.slice(TRPC_PREFIX.length)
    : event.rawPath;
  return { ...event, rawPath };
}

/** The tRPC adapter both functions share: one procedure per request, the request id on every answer. */
export function serveTrpc(
  event: APIGatewayProxyEventV2,
  lambdaContext: Pick<LambdaContext, 'getRemainingTimeInMillis'> & Partial<LambdaContext>,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  const trpc = awsLambdaRequestHandler({
    router: appRouter,
    // httpLink sends one procedure per request; a batch would slip past the per-route throttles.
    allowBatching: false,
    createContext: () => context,
    responseMeta: () => ({
      headers: { 'x-request-id': context.requestId, 'cache-control': 'no-store' },
    }),
    onError: ({ error, path }) => {
      const expected = error.code !== 'INTERNAL_SERVER_ERROR';
      const fields = { path, code: error.code, error: expected ? error.message : error };
      if (expected) logger.warn('procedure failed', fields);
      else logger.error('procedure failed', fields);
    },
  });
  return trpc(withoutPrefix(event), lambdaContext as LambdaContext);
}
