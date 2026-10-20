import { runInNewContext } from 'node:vm';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';
import { THROTTLES } from '../lib/leads-api';
import { SPA_ROUTING_FUNCTION, runtimeConfig } from '../lib/web-hosting';
import { API_BASE, cleanupFixtures, synth } from './fixtures';

afterAll(cleanupFixtures);

describe('RoofingCrm stack', () => {
  it('lives in us-east-2 with termination protection', () => {
    const { stack } = synth();
    expect(stack.region).toBe('us-east-2');
    expect(stack.terminationProtection).toBe(true);
  });

  it('keeps one private, encrypted, TLS-only bucket that survives stack deletion', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: Match.objectLike({
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        }),
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 's3:GetObject',
          }),
        ]),
      },
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('routes the SPA with a viewer-request function, never with distribution-wide error pages', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        HttpVersion: 'http2and3',
        CustomErrorResponses: Match.absent(),
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
        }),
      }),
    });
  });

  it('serves the basemap uncompressed, without the routing function', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: 'basemap/*',
            Compress: false,
            FunctionAssociations: Match.absent(),
          }),
        ]),
      }),
    });
  });

  it('sends a CSP that allows the pipeline API and nothing unsafe', () => {
    const { template } = synth();
    const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
    const csp = JSON.stringify(policies);
    expect(csp).toContain(`connect-src 'self' ${API_BASE}`);
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toMatch(/unsafe-/);
    expect(csp).toContain('geolocation=(self)');
  });

  it('writes the pipeline API base into /config.json', () => {
    expect(runtimeConfig({ pipelineApiBase: API_BASE })).toEqual({ pipelineApiBase: API_BASE });
    expect(runtimeConfig({ pipelineApiBase: null })).toEqual({ pipelineApiBase: null });
  });

  it('uploads the basemap only when one is given, with object keys kept out of the response', () => {
    synth({ basemapDir: null }).template.resourceCountIs('Custom::CDKBucketDeployment', 2);
    const { template } = synth();
    template.resourceCountIs('Custom::CDKBucketDeployment', 3);
    template.allResourcesProperties('Custom::CDKBucketDeployment', { OutputObjectKeys: false });
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DestinationBucketKeyPrefix: 'basemap/',
      DistributionPaths: ['/basemap/*'],
    });
  });

  it('caches hashed bundles for a year and revalidates the entry files', () => {
    const { template } = synth();
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      Include: ['assets/*'],
      Prune: false,
      SystemMetadata: { 'cache-control': 'public, max-age=31536000, immutable' },
    });
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      Exclude: ['assets/*', 'basemap/*'],
      SystemMetadata: { 'cache-control': 'no-cache' },
      DistributionPaths: ['/index.html', '/config.json', '/favicon.svg'],
    });
  });

  it('keeps the deployment helper logs for 90 days', () => {
    synth().template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 90 });
  });

  it('tags the resources with project_name for the cost table', () => {
    const { template } = synth();
    for (const type of [
      'AWS::S3::Bucket',
      'AWS::CloudFront::Distribution',
      'AWS::Logs::LogGroup',
      'AWS::DynamoDB::Table',
      'AWS::Lambda::Function',
      'AWS::SNS::Topic',
    ]) {
      template.hasResourceProperties(type, {
        Tags: Match.arrayWith([{ Key: 'project_name', Value: 'roofing-crm' }]),
      });
    }
    // API Gateway v2 resources take their tags as a map.
    for (const type of ['AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage']) {
      template.hasResourceProperties(type, { Tags: { project_name: 'roofing-crm' } });
    }
  });

  it('outputs the public URL', () => {
    const { template } = synth();
    template.hasOutput('WebUrl', Match.anyValue());
    template.hasOutput('PipelineApiBase', { Value: API_BASE });
  });

  it('warns when synthesized without deploy inputs, as CI does', () => {
    const { stack } = synth({ pipelineApiBase: null, basemapDir: null });
    const annotations = Annotations.fromStack(stack);
    annotations.hasWarning('/RoofingCrm', Match.stringLikeRegexp('pipelineApiBase is not set'));
    annotations.hasWarning('/RoofingCrm', Match.stringLikeRegexp('basemapDir is not set'));
    expect(runtimeConfig({ pipelineApiBase: null })).toEqual({ pipelineApiBase: null });
  });
});

describe('the CRM API (F3)', () => {
  it('keeps leads in an on-demand table keyed by workspace and lead, with point-in-time recovery', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'workspace_id', KeyType: 'HASH' },
          { AttributeName: 'lead_key', KeyType: 'RANGE' },
        ],
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      },
    });
  });

  it('runs one traced leads function on Node 22, 29 s, without reserved concurrency', () => {
    const { template } = synth();
    const functions = template.findResources('AWS::Lambda::Function', {
      Properties: { Handler: 'index.handler' },
    });
    const leads = Object.values(functions).filter(
      (fn) =>
        (fn as { Properties: { Environment?: { Variables?: Record<string, unknown> } } }).Properties
          .Environment?.Variables?.LEADS_TABLE !== undefined,
    );
    expect(leads).toHaveLength(1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 29,
      MemorySize: 1024,
      TracingConfig: { Mode: 'Active' },
      ReservedConcurrentExecutions: Match.absent(),
      Environment: {
        Variables: Match.objectLike({
          PIPELINE_API_BASE: API_BASE,
          POWERTOOLS_SERVICE_NAME: 'roofing-crm-api',
          POWERTOOLS_METRICS_NAMESPACE: 'RoofingCrm',
          LEADS_TABLE: Match.anyValue(),
        }),
      },
    });
  });

  it('lets the function read and write only the leads table', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
            Effect: 'Allow',
          }),
        ]),
      },
    });
    expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).not.toContain(
      'dynamodb:DeleteItem',
    );
  });

  it('routes each mutation on its own throttled route and queries through one GET catch-all', () => {
    const { template } = synth();
    const keys = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (route) => (route as { Properties: { RouteKey: string } }).Properties.RouteKey,
    );
    expect(keys.sort()).toEqual([
      'GET /api/trpc/{proxy+}',
      'POST /api/trpc/leads.create',
      'POST /api/trpc/leads.createMany',
    ]);
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: {
        ThrottlingRateLimit: THROTTLES.stage.rateLimit,
        ThrottlingBurstLimit: THROTTLES.stage.burstLimit,
      },
      RouteSettings: {
        'POST /api/trpc/leads.create': { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 },
        'POST /api/trpc/leads.createMany': { ThrottlingRateLimit: 0.5, ThrottlingBurstLimit: 2 },
      },
      AccessLogSettings: { Format: Match.stringLikeRegexp('\\$context.requestId') },
    });
    const stage = JSON.stringify(template.findResources('AWS::ApiGatewayV2::Stage'));
    expect(stage).not.toContain('sourceIp');
  });

  it('serves the API same-origin under /api/*, never cached and never redirected', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: 'api/*',
            ViewerProtocolPolicy: 'https-only',
            AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
            OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
            FunctionAssociations: Match.absent(),
          }),
        ]),
      }),
    });
  });

  it('keeps the function and access logs for 90 days', () => {
    const { template } = synth();
    const groups = Object.values(template.findResources('AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) {
      expect(
        (group as { Properties: { RetentionInDays: number } }).Properties.RetentionInDays,
      ).toBe(90);
    }
  });

  it('raises self-resolving alarms on one topic for failures, throttles and a pipeline outage', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::CloudWatch::Alarm', 5);
    template.allResourcesProperties('AWS::CloudWatch::Alarm', {
      TreatMissingData: 'notBreaching',
      AlarmActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('Alerts') })],
      OKActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('Alerts') })],
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Threshold: 5,
      Metrics: Match.arrayWith([
        Match.objectLike({
          MetricStat: Match.objectLike({
            Metric: Match.objectLike({
              Namespace: 'RoofingCrm',
              MetricName: 'PipelineCallFailed',
              Dimensions: Match.arrayWith([{ Name: 'status', Value: 'timeout' }]),
            }),
          }),
        }),
      ]),
    });
    template.resourceCountIs('AWS::SNS::Subscription', 0);
  });

  it('outputs what the handoff links to', () => {
    const { template } = synth();
    for (const output of [
      'ApiId',
      'LeadsFunctionName',
      'LeadsLogGroup',
      'ApiAccessLogGroup',
      'LeadsTableName',
      'AlertsTopicArn',
    ]) {
      template.hasOutput(output, Match.anyValue());
    }
  });
});

describe('SPA routing function', () => {
  const route = (uri: string): string => {
    const handler = runInNewContext(`${SPA_ROUTING_FUNCTION}; handler`) as (event: {
      request: { uri: string };
    }) => { uri: string };
    return handler({ request: { uri } }).uri;
  };

  it('serves index.html for the root and extension-less paths', () => {
    expect(route('/')).toBe('/index.html');
    expect(route('/leads')).toBe('/index.html');
  });

  it('leaves files alone', () => {
    expect(route('/config.json')).toBe('/config.json');
    expect(route('/assets/index-abc.js')).toBe('/assets/index-abc.js');
  });
});
