import { Annotations, CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { DeployInputs } from './deploy-inputs';
import { LeadsApi } from './leads-api';
import { WebHosting } from './web-hosting';

export const STACK_NAME = 'RoofingCrm';
export const PROJECT_TAG = { key: 'project_name', value: 'roofing-crm' } as const;

export type RoofingCrmStackProps = StackProps & DeployInputs;

/**
 * The CRM's one stack (us-east-2, no stage suffix, no hard-coded physical names; metagross items 9, 10,
 * 24): the map app and its basemap (F1), and the CRM API with its table and alarms (F3).
 */
export class RoofingCrmStack extends Stack {
  constructor(scope: Construct, id: string, props: RoofingCrmStackProps) {
    super(scope, id, {
      ...props,
      description:
        'Roofing CRM: map web app, self-hosted basemap and leads API (S3, CloudFront, HTTP API, Lambda, DynamoDB)',
      terminationProtection: props.terminationProtection ?? true,
      tags: { ...props.tags, [PROJECT_TAG.key]: PROJECT_TAG.value },
    });
    Tags.of(this).add(PROJECT_TAG.key, PROJECT_TAG.value);

    const api = new LeadsApi(this, 'Api', { pipelineApiBase: props.pipelineApiBase });
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
    new CfnOutput(this, 'PipelineApiBase', {
      description: 'The pipeline API the deployed app calls (from /config.json)',
      value: props.pipelineApiBase ?? 'not configured',
    });
  }
}
