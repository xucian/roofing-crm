import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { ulid } from '@roofing-crm/shared';
import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
import { readConfig, type ApiConfig } from './config';
import type { Context } from './context';
import { startDeadline } from './deadline';
import { createLeadRepository, type LeadRepository } from './leads/repository';
import { createLeadService } from './leads/service';
import { RequestMetrics, logger, metrics, tracer } from './observability';
import { createServerPipeline } from './pipeline';
import { appRouter } from './routers';

/** The CRM API's base path behind CloudFront's `/api/*` behaviour; fixed once deployed. */
export const TRPC_PREFIX = '/api/trpc';

export interface HandlerDeps {
  config: ApiConfig;
  repository: LeadRepository;
  /** Replaced in tests. */
  fetch?: (request: Request) => Promise<Response>;
}

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

/** One request: its id, deadline, metrics and services, then tRPC. */
export async function handleRequest(
  event: APIGatewayProxyEventV2,
  lambdaContext: Pick<LambdaContext, 'getRemainingTimeInMillis'> & Partial<LambdaContext>,
  deps: HandlerDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext.requestId;
  logger.appendKeys({ request_id: requestId });
  if (tracer.isTracingEnabled()) tracer.putAnnotation('request_id', requestId);

  const requestMetrics = new RequestMetrics();
  const deadline = startDeadline(lambdaContext.getRemainingTimeInMillis());
  const pipeline = createServerPipeline({
    baseUrl: deps.config.pipelineApiBase,
    deadline,
    metrics: requestMetrics,
    logger,
    tracer,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  const context: Context = {
    requestId,
    logger,
    metrics: requestMetrics,
    leads: createLeadService({
      repository: deps.repository,
      pipeline,
      deadline,
      metrics: requestMetrics,
      logger,
      newId: () => ulid(),
    }),
  };

  const trpc = awsLambdaRequestHandler({
    router: appRouter,
    // httpLink sends one procedure per request; a batch would slip past the per-route throttles.
    allowBatching: false,
    createContext: () => context,
    responseMeta: () => ({
      headers: { 'x-request-id': requestId, 'cache-control': 'no-store' },
    }),
    onError: ({ error, path }) => {
      const expected = error.code !== 'INTERNAL_SERVER_ERROR';
      const fields = { path, code: error.code, error: expected ? error.message : error };
      if (expected) logger.warn('procedure failed', fields);
      else logger.error('procedure failed', fields);
    },
  });

  try {
    return await trpc(withoutPrefix(event), lambdaContext as LambdaContext);
  } finally {
    requestMetrics.flush(metrics);
  }
}

let deps: HandlerDeps | undefined;

/** Built once per execution environment: configuration, the traced DynamoDB client, the table. */
function productionDeps(): HandlerDeps {
  if (deps) return deps;
  const config = readConfig();
  const dynamo = tracer.captureAWSv3Client(new DynamoDBClient({}));
  const doc = DynamoDBDocumentClient.from(dynamo, {
    marshallOptions: { removeUndefinedValues: true },
  });
  deps = { config, repository: createLeadRepository(doc, config.leadsTable) };
  return deps;
}

export const handler = middy(
  (
    event: APIGatewayProxyEventV2,
    context: LambdaContext,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    metrics.captureColdStartMetric(context.functionName);
    return handleRequest(event, context, productionDeps());
  },
)
  .use(captureLambdaHandler(tracer, { captureResponse: false }))
  .use(injectLambdaContext(logger, { resetKeys: true }));
