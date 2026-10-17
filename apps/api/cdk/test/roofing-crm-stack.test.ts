import { runInNewContext } from 'node:vm';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';
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
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: 'basemap/*',
            Compress: false,
            FunctionAssociations: Match.absent(),
          }),
        ],
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
    ]) {
      template.hasResourceProperties(type, {
        Tags: Match.arrayWith([{ Key: 'project_name', Value: 'roofing-crm' }]),
      });
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
