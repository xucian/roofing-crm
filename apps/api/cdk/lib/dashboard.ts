import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import {
  CHAT_FAILURE_REASONS,
  METRIC,
  METRICS_NAMESPACE,
  PIPELINE_FAILURE_STATUSES,
  SERVICE_NAME,
} from '../../src/metric-names';
import type { LeadsApi } from './leads-api';

/** The free tier counts 50 metrics per dashboard; this one stays under it (the stack test counts). */
export const DASHBOARD_METRIC_BUDGET = 50;

const CHAT_OUTCOMES = [
  'answered',
  'no_matches',
  'needs_clarification',
  'out_of_scope',
  'out_of_county',
  'limit_reached',
  'tool_error',
] as const;

/**
 * The CRM's CloudWatch dashboard (metagross item 17, built at F5; docs/decisions.md, F5 entry): the
 * two functions, the HTTP API, the lead and chat business metrics, the pipeline calls, Bedrock and
 * the alarms, one widget per concern. It is the account's third dashboard, inside the free tier.
 */
export class CrmDashboard extends Construct {
  readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, api: LeadsApi) {
    super(scope, id);
    const five = Duration.minutes(5);
    const crm = (
      metricName: string,
      dimensions: Record<string, string> = {},
      statistic = 'Sum',
      label?: string,
    ) =>
      new cloudwatch.Metric({
        namespace: METRICS_NAMESPACE,
        metricName,
        dimensionsMap: { service: SERVICE_NAME, ...dimensions },
        statistic,
        period: five,
        ...(label ? { label } : {}),
      });
    const bedrock = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName,
        dimensionsMap: { ModelId: api.bedrockModelId },
        statistic: 'Sum',
        period: five,
      });
    const lambdaWidgets = (title: string, fn: LeadsApi['function']) => [
      new cloudwatch.GraphWidget({
        title: `${title}: invocations, errors, throttles`,
        left: [
          fn.metricInvocations({ period: five }),
          fn.metricErrors({ period: five }),
          fn.metricThrottles({ period: five }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: `${title}: duration p95`,
        left: [fn.metricDuration({ period: five, statistic: 'p95' })],
        width: 4,
      }),
    ];

    const widgets: cloudwatch.IWidget[][] = [
      [
        new cloudwatch.TextWidget({
          markdown: `# Roofing CRM\nLeads and agent functions, the CRM API, the pipeline calls and Bedrock. Every metric is listed in docs/metrics.md; namespace \`${METRICS_NAMESPACE}\`, service \`${SERVICE_NAME}\`.`,
          width: 24,
          height: 2,
        }),
      ],
      [
        ...lambdaWidgets('Leads function', api.function),
        ...lambdaWidgets('Agent function', api.agentFunction),
      ],
      [
        new cloudwatch.GraphWidget({
          title: 'CRM API: 4xx and 5xx',
          left: [
            api.httpApi.metricClientError({ period: five }),
            api.httpApi.metricServerError({ period: five }),
          ],
          width: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Leads processed, by operation',
          left: ['create', 'update', 'delete'].map((operation) =>
            crm(METRIC.leadProcessed, { operation }, 'Sum', operation),
          ),
          width: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Lead rows not saved, by reason',
          left: ['not_found', 'mismatch', 'pipeline', 'deadline'].map((reason) =>
            crm(METRIC.leadFailed, { operation: 'create', reason }, 'Sum', reason),
          ),
          width: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Procedure duration p95 (ms)',
          left: ['create', 'update', 'list', 'chat'].map((operation) =>
            crm(METRIC.processingDuration, { operation }, 'p95', operation),
          ),
          width: 6,
        }),
      ],
      [
        new cloudwatch.GraphWidget({
          title: 'Pipeline calls: answered and failed by status',
          left: [
            crm(METRIC.pipelineCallProcessed, {}, 'Sum', 'answered'),
            ...PIPELINE_FAILURE_STATUSES.map((status) =>
              crm(METRIC.pipelineCallFailed, { status }, 'Sum', `failed ${status}`),
            ),
          ],
          width: 8,
        }),
        new cloudwatch.GraphWidget({
          title: 'Chat turns, by outcome',
          left: CHAT_OUTCOMES.map((outcome) => crm(METRIC.chatTurn, { outcome }, 'Sum', outcome)),
          stacked: true,
          width: 8,
        }),
        new cloudwatch.GraphWidget({
          title: 'Chat turns without an answer, and refused',
          left: [
            ...CHAT_FAILURE_REASONS.map((reason) =>
              crm(METRIC.chatFailed, { reason }, 'Sum', `failed ${reason}`),
            ),
            ...['budget_exhausted', 'circuit_open'].map((reason) =>
              crm(METRIC.chatRefused, { reason }, 'Sum', `refused ${reason}`),
            ),
          ],
          width: 8,
        }),
      ],
      [
        new cloudwatch.GraphWidget({
          title: 'Chat model tokens',
          left: [
            crm(METRIC.chatInputTokens, {}, 'Sum', 'input'),
            crm(METRIC.chatOutputTokens, {}, 'Sum', 'output'),
          ],
          width: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Chat turn latency p95 (ms)',
          left: [crm(METRIC.chatTurnLatency, {}, 'p95', 'p95')],
          width: 6,
        }),
        new cloudwatch.GraphWidget({
          title: `Bedrock ${api.bedrockModelId}`,
          left: [bedrock('Invocations'), bedrock('InvocationThrottles')],
          right: [bedrock('InputTokenCount'), bedrock('OutputTokenCount')],
          width: 12,
        }),
      ],
      [
        new cloudwatch.AlarmStatusWidget({
          title: 'Alarms',
          alarms: api.alarms,
          width: 24,
        }),
      ],
    ];

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      defaultInterval: Duration.hours(24),
      widgets,
    });
  }
}
