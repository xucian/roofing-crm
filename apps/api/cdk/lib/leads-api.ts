import { fileURLToPath } from 'node:url';
import { Aws, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import {
  METRIC,
  METRICS_NAMESPACE,
  PIPELINE_OUTAGE_STATUSES,
  SERVICE_NAME,
} from '../../src/metric-names';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const HANDLER_ENTRY = fileURLToPath(new URL('../../src/handler.ts', import.meta.url));

/** The CRM API's base path; CloudFront sends `/api/*` here unchanged. Fixed once deployed. */
export const API_BASE_PATH = '/api/trpc';

/** The mutations, each on its own POST route so its throttle applies (httpLink, no batching). */
export const MUTATIONS = ['create', 'createMany', 'update', 'delete'] as const;

/**
 * Route throttles (metagross item 4), tighter than its example. `createMany` reads the pipeline once
 * per row for up to 25 s; `update` and `delete` are one DynamoDB write each. Queries share the stage
 * default.
 */
export const THROTTLES = {
  stage: { rateLimit: 10, burstLimit: 20 },
  routes: {
    [`POST ${API_BASE_PATH}/leads.create`]: { rateLimit: 2, burstLimit: 5 },
    [`POST ${API_BASE_PATH}/leads.createMany`]: { rateLimit: 0.5, burstLimit: 2 },
    [`POST ${API_BASE_PATH}/leads.update`]: { rateLimit: 2, burstLimit: 5 },
    [`POST ${API_BASE_PATH}/leads.delete`]: { rateLimit: 2, burstLimit: 5 },
  },
} satisfies {
  stage: { rateLimit: number; burstLimit: number };
  routes: Record<`POST ${typeof API_BASE_PATH}/leads.${(typeof MUTATIONS)[number]}`, object>;
};

/**
 * The `leads` function's reserved concurrency (§3, metagross item 9): its bulkhead, so the F5 agent
 * cannot starve lead writes, and its cap. It covers the route throttles' worst case: two 25 s
 * `createMany` calls plus creates, edits and lists. The account allows 1,000 executions since the
 * increase (docs/decisions.md, 2026-10-20 F4 entry).
 */
export const LEADS_RESERVED_CONCURRENCY = 10;

/** Lambda timeout: above the 25 s handler deadline, under API Gateway's 30 s integration cap. */
export const FUNCTION_TIMEOUT = Duration.seconds(29);

export interface LeadsApiProps {
  /** The pipeline API v1 base the function reads snapshots from; null in a synth without inputs. */
  pipelineApiBase: string | null;
}

/**
 * The CRM API (F3, F4): one `leads` NodejsFunction serving tRPC, a DynamoDB table of leads, an HTTP API
 * whose routes CloudFront reaches under `/api/*`, and the alarms that watch them (metagross items 3,
 * 4, 9, 15, 16, 18, 22). The agent function joins in F5.
 */
export class LeadsApi extends Construct {
  readonly table: dynamodb.Table;
  readonly function: nodejs.NodejsFunction;
  readonly functionLogs: logs.LogGroup;
  readonly accessLogs: logs.LogGroup;
  readonly httpApi: apigwv2.HttpApi;
  readonly alerts: sns.Topic;
  readonly alarms: cloudwatch.Alarm[] = [];
  /** The HTTP API's host, CloudFront's origin for `/api/*`. */
  readonly originDomain: string;

  constructor(scope: Construct, id: string, props: LeadsApiProps) {
    super(scope, id);

    // Partition per browser workspace, one item per property or permit (docs/decisions.md §5).
    this.table = new dynamodb.Table(this, 'Leads', {
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'lead_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // The write API is public: point-in-time recovery can undo a vandalised workspace.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      // Leads are user data; a stack deletion keeps the table (docs/runbook.md, teardown).
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.functionLogs = new logs.LogGroup(this, 'FunctionLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.function = new nodejs.NodejsFunction(this, 'Function', {
      description: 'Roofing CRM API: leads (tRPC)',
      entry: HANDLER_ENTRY,
      handler: 'handler',
      projectRoot: REPO_ROOT,
      depsLockFilePath: `${REPO_ROOT}pnpm-lock.yaml`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: FUNCTION_TIMEOUT,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: this.functionLogs,
      reservedConcurrentExecutions: LEADS_RESERVED_CONCURRENCY,
      environment: {
        LEADS_TABLE: this.table.tableName,
        ...(props.pipelineApiBase === null ? {} : { PIPELINE_API_BASE: props.pipelineApiBase }),
        POWERTOOLS_SERVICE_NAME: SERVICE_NAME,
        POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE,
        POWERTOOLS_LOG_LEVEL: 'INFO',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        // Everything is bundled, the AWS SDK included, so the function runs the versions it was tested with.
        externalModules: [],
      },
    });
    this.table.grant(
      this.function,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${Stack.of(this).stackName}-api`,
      description: 'Roofing CRM API (tRPC under /api/trpc), reached through CloudFront',
      createDefaultStage: false,
    });

    this.accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const stage = new apigwv2.HttpStage(this, 'Stage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: THROTTLES.stage,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(this.accessLogs),
        // No source IP or user agent: the request id joins this line to the function's logs.
        format: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            time: '$context.requestTime',
            routeKey: '$context.routeKey',
            status: '$context.status',
            responseLength: '$context.responseLength',
            responseLatency: '$context.responseLatency',
            integrationLatency: '$context.integrationLatency',
            integrationStatus: '$context.integrationStatus',
            integrationError: '$context.integrationErrorMessage',
          }),
        ),
      },
    });

    // Each mutation has its own route, so its throttle applies (httpLink, no batching); queries share
    // a GET catch-all. Any other method or path is answered by API Gateway with 404.
    const integration = new HttpLambdaIntegration('Leads', this.function);
    const routes = [
      ...MUTATIONS.flatMap((mutation) =>
        this.httpApi.addRoutes({
          path: `${API_BASE_PATH}/leads.${mutation}`,
          methods: [apigwv2.HttpMethod.POST],
          integration,
        }),
      ),
      ...this.httpApi.addRoutes({
        path: `${API_BASE_PATH}/{proxy+}`,
        methods: [apigwv2.HttpMethod.GET],
        integration,
      }),
    ];
    // `RouteSettings` is a map the L1 passes through as it is, so its keys are CloudFormation's.
    const cfnStage = stage.node.defaultChild as apigwv2.CfnStage;
    cfnStage.routeSettings = Object.fromEntries(
      Object.entries(THROTTLES.routes).map(([routeKey, limits]) => [
        routeKey,
        { ThrottlingRateLimit: limits.rateLimit, ThrottlingBurstLimit: limits.burstLimit },
      ]),
    );
    // Route settings name routes by key, so the routes must exist first.
    for (const route of routes) stage.node.addDependency(route);

    this.originDomain = `${this.httpApi.apiId}.execute-api.${Aws.REGION}.${Aws.URL_SUFFIX}`;

    // One topic for every alarm, ALARM and OK alike, so each alarm resolves itself (metagross items
    // 18, 19). Its email subscription is made by the deploy script, outside the template.
    this.alerts = new sns.Topic(this, 'Alerts', { displayName: 'Roofing CRM alerts' });
    const action = new SnsAction(this.alerts);
    const fiveMinutes = Duration.minutes(5);
    const alarm = (
      alarmId: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
    ): void => {
      const created = new cloudwatch.Alarm(this, alarmId, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });
      created.addAlarmAction(action);
      created.addOkAction(action);
      this.alarms.push(created);
    };

    alarm(
      'FunctionErrors',
      this.function.metricErrors({ period: fiveMinutes, statistic: 'Sum' }),
      1,
      'The leads function failed (an error, a crash or a timeout) in the last 5 minutes.',
    );
    alarm(
      'FunctionThrottles',
      this.function.metricThrottles({ period: fiveMinutes, statistic: 'Sum' }),
      1,
      `The leads function was throttled: it reached its reserved concurrency of ${String(LEADS_RESERVED_CONCURRENCY)}.`,
    );
    alarm(
      'Api5xx',
      this.httpApi.metricServerError({ period: fiveMinutes, statistic: 'Sum' }),
      1,
      'The CRM API answered 5xx: a function failure, or the pipeline failing a lead save.',
    );
    alarm(
      'TableSystemErrors',
      this.table.metricSystemErrorsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.QUERY,
          dynamodb.Operation.UPDATE_ITEM,
          dynamodb.Operation.DELETE_ITEM,
        ],
        period: fiveMinutes,
      }),
      1,
      'DynamoDB failed requests on the leads table.',
    );
    const outage = Object.fromEntries(
      PIPELINE_OUTAGE_STATUSES.map((status, index) => [
        `m${String(index)}`,
        new cloudwatch.Metric({
          namespace: METRICS_NAMESPACE,
          metricName: METRIC.pipelineCallFailed,
          dimensionsMap: { service: SERVICE_NAME, status },
          statistic: 'Sum',
          period: fiveMinutes,
        }),
      ]),
    );
    alarm(
      'PipelineOutage',
      new cloudwatch.MathExpression({
        expression: Object.keys(outage).join(' + '),
        usingMetrics: outage,
        period: fiveMinutes,
        label: 'Pipeline calls failed with 5xx or a timeout',
      }),
      5,
      'At least 5 pipeline calls from the leads function failed with 5xx or a timeout in 5 minutes: the CRM cannot save leads.',
    );
  }
}
