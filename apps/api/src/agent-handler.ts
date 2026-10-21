import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { AGENT_NAME, ulid } from '@roofing-crm/shared';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from 'aws-lambda';
import { CircuitBreaker } from './agent/governor';
import { langSmithLoader, type LangSmithFacade } from './agent/langsmith';
import { DEFAULT_MODEL_ID, bedrockModel } from './agent/model';
import { createAgentService } from './agent/service';
import type { TurnDeps } from './agent/turn';
import { createDailyUsage, type DailyUsage } from './agent/usage';
import { DAILY_LIMITS, readConfig, type ApiConfig } from './config';
import type { Context } from './context';
import { deadlineFrom } from './deadline';
import { createLeadRepository, type LeadRepository } from './leads/repository';
import { createLeadService } from './leads/service';
import { RequestMetrics, logger, metrics, tracer } from './observability';
import { createServerPipeline } from './pipeline';
import { serveTrpc } from './serve';

export interface AgentHandlerDeps {
  config: ApiConfig;
  modelId: string;
  model: TurnDeps['model'];
  langsmith: () => Promise<LangSmithFacade>;
  repository: LeadRepository;
  usage: DailyUsage;
  breaker: CircuitBreaker;
  /** Replaced in tests. */
  fetch?: (request: Request) => Promise<Response>;
  limits?: TurnDeps['limits'];
  now?: () => number;
}

/**
 * One request of the `agent` function (F5): `agent.chat` through the same tRPC router, with the lead
 * service for the lead tools and the agent for the turn. The deadline counts from API Gateway's
 * receipt; a hand-made event without a recent `timeEpoch` counts from now.
 */
export async function handleAgentRequest(
  event: APIGatewayProxyEventV2,
  lambdaContext: Pick<LambdaContext, 'getRemainingTimeInMillis'> & Partial<LambdaContext>,
  deps: AgentHandlerDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const now = deps.now ?? Date.now;
  const requestId = event.requestContext.requestId;
  logger.appendKeys({ request_id: requestId, agent: AGENT_NAME });
  if (tracer.isTracingEnabled()) tracer.putAnnotation('request_id', requestId);
  const epoch = event.requestContext.timeEpoch;
  const receivedAt = Math.abs(now() - epoch) < 60_000 ? epoch : now();

  const requestMetrics = new RequestMetrics();
  const deadline = deadlineFrom(receivedAt, lambdaContext.getRemainingTimeInMillis(), now);
  const pipeline = createServerPipeline({
    baseUrl: deps.config.pipelineApiBase,
    deadline,
    metrics: requestMetrics,
    logger,
    tracer,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  const leads = createLeadService({
    repository: deps.repository,
    pipeline,
    deadline,
    metrics: requestMetrics,
    logger,
    newId: () => ulid(),
  });
  const context: Context = {
    requestId,
    logger,
    metrics: requestMetrics,
    leads,
    agent: createAgentService({
      requestId,
      receivedAt,
      pipeline,
      leads,
      usage: deps.usage,
      breaker: deps.breaker,
      langsmith: deps.langsmith,
      model: deps.model,
      modelId: deps.modelId,
      metrics: requestMetrics,
      logger,
      now,
      ...(deps.limits ? { limits: deps.limits } : {}),
    }),
  };
  try {
    return await serveTrpc(event, lambdaContext, context);
  } finally {
    requestMetrics.flush(metrics);
  }
}

const positive = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

let deps: AgentHandlerDeps | undefined;

/** Built once per execution environment: configuration, model, tracing, table, usage, breaker. */
function productionDeps(): AgentHandlerDeps {
  if (deps) return deps;
  const config = readConfig();
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
  // Bounded: the daily-budget update runs before the turn and must not eat its deadline (item 20).
  const dynamo = tracer.captureAWSv3Client(
    new DynamoDBClient({
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
    }),
  );
  const doc = DynamoDBDocumentClient.from(dynamo, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const langsmith = langSmithLoader(
    {
      LANGSMITH_TRACING: process.env.LANGSMITH_TRACING,
      LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT ?? AGENT_NAME,
      LANGSMITH_ENDPOINT: process.env.LANGSMITH_ENDPOINT,
      LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
      LANGSMITH_API_KEY_SECRET_ID: process.env.LANGSMITH_API_KEY_SECRET_ID,
      AWS_REGION: process.env.AWS_REGION,
    },
    undefined,
    (error) => {
      logger.warn('tracing disabled', { error: error instanceof Error ? error.name : 'unknown' });
    },
  );
  // Read the secret at init, so the first turn finds the facade ready or nearly so.
  void langsmith();
  deps = {
    config,
    modelId,
    model: bedrockModel(modelId, undefined, (usage) => {
      logger.info('Bedrock prompt cache usage.', {
        bedrockPromptCacheReadInputTokens: usage.cacheReadTokens,
        bedrockPromptCacheWriteInputTokens: usage.cacheWriteTokens,
      });
    }),
    langsmith,
    repository: createLeadRepository(doc, config.leadsTable),
    usage: createDailyUsage(doc, config.leadsTable, {
      turns: positive(process.env.AGENT_DAILY_TURNS, DAILY_LIMITS.turns),
      tokens: positive(process.env.AGENT_DAILY_TOKENS, DAILY_LIMITS.tokens),
    }),
    breaker: new CircuitBreaker(),
  };
  return deps;
}

export const handler = middy(
  (
    event: APIGatewayProxyEventV2,
    context: LambdaContext,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    metrics.captureColdStartMetric(context.functionName);
    return handleAgentRequest(event, context, productionDeps());
  },
)
  .use(captureLambdaHandler(tracer, { captureResponse: false }))
  .use(injectLambdaContext(logger, { resetKeys: true }));
