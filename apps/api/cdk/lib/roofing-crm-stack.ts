import { Annotations, CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { CrmDashboard } from './dashboard';
import type { DeployInputs } from './deploy-inputs';
import { LeadsApi } from './leads-api';
import { WebHosting } from './web-hosting';

export const STACK_NAME = 'RoofingCrm';
export const PROJECT_TAG = { key: 'project_name', value: 'roofing-crm' } as const;

export type RoofingCrmStackProps = StackProps &
  Omit<DeployInputs, 'langsmithSecretName' | 'bedrockModelId'> &
  Partial<Pick<DeployInputs, 'langsmithSecretName' | 'bedrockModelId'>>;

/**
 * The CRM's one stack (us-east-2, no stage suffix, no hard-coded physical names; metagross items 9, 10,
 * 24): the map app and its basemap (F1), the CRM API with its table and alarms (F3, F4), the agent
 * and the dashboard (F5).
 */
export class RoofingCrmStack extends Stack {
  constructor(scope: Construct, id: string, props: RoofingCrmStackProps) {
    super(scope, id, {
      ...props,
      description:
        'Roofing CRM: map web app, self-hosted basemap, leads API and agent (S3, CloudFront, HTTP API, Lambda, DynamoDB, Bedrock)',
      terminationProtection: props.terminationProtection ?? true,
      tags: { ...props.tags, [PROJECT_TAG.key]: PROJECT_TAG.value },
    });
    Tags.of(this).add(PROJECT_TAG.key, PROJECT_TAG.value);

    const api = new LeadsApi(this, 'Api', {
      pipelineApiBase: props.pipelineApiBase,
      langsmithSecretName: props.langsmithSecretName ?? null,
      ...(props.bedrockModelId ? { bedrockModelId: props.bedrockModelId } : {}),
    });
    const dashboard = new CrmDashboard(this, 'Observability', api);
    const web = new WebHosting(this, 'Web', {
      pipelineApiBase: props.pipelineApiBase,
      webDistDir: props.webDistDir,
      basemapDir: props.basemapDir,
      apiOriginDomain: api.originDomain,
    });

    if (props.pipelineApiBase === null) {
      Annotations.of(this).addWarningV2(
        'roofing-crm:no-pipeline-api-base',
        'pipelineApiBase is not set: config.json says null and the app shows "Pipeline API not configured". The deploy script requires it.',
      );
    }
    if (props.basemapDir === null) {
      Annotations.of(this).addWarningV2(
        'roofing-crm:no-basemap',
        'basemapDir is not set: the basemap is not uploaded. The deploy script requires it.',
      );
    }

    new CfnOutput(this, 'WebUrl', {
      description: 'The public CRM URL',
      value: `https://${web.distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'DistributionId', { value: web.distribution.distributionId });
    new CfnOutput(this, 'WebBucketName', { value: web.bucket.bucketName });
    new CfnOutput(this, 'ApiId', { value: api.httpApi.apiId });
    new CfnOutput(this, 'LeadsFunctionName', { value: api.function.functionName });
    new CfnOutput(this, 'LeadsLogGroup', { value: api.functionLogs.logGroupName });
    new CfnOutput(this, 'ApiAccessLogGroup', { value: api.accessLogs.logGroupName });
    new CfnOutput(this, 'LeadsTableName', { value: api.table.tableName });
    new CfnOutput(this, 'AlertsTopicArn', { value: api.alerts.topicArn });
    new CfnOutput(this, 'AgentFunctionName', { value: api.agentFunction.functionName });
    new CfnOutput(this, 'AgentLogGroup', { value: api.agentLogs.logGroupName });
    new CfnOutput(this, 'BedrockModelId', { value: api.bedrockModelId });
    new CfnOutput(this, 'DashboardName', { value: dashboard.dashboard.dashboardName });
    new CfnOutput(this, 'PipelineApiBase', {
      description: 'The pipeline API the deployed app calls (from /config.json)',
      value: props.pipelineApiBase ?? 'not configured',
    });
  }
}
