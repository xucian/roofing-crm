import { BASEMAP_PREFIX, PERMISSIONS_POLICY, contentSecurityPolicy } from '@roofing-crm/shared';
import { Duration, RemovalPolicy, Size } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface WebHostingProps {
  /** Written to /config.json and allowed by the CSP's connect-src; null in a synth without deploy inputs. */
  pipelineApiBase: string | null;
  /** The built web app (apps/web/dist). */
  webDistDir: string;
  /** The output of `pnpm basemap`; null skips the basemap upload. */
  basemapDir: string | null;
  /** The CRM API's HTTP API host, served same-origin under `/api/*`. */
  apiOriginDomain: string;
}

/** What the SPA reads at start (apps/web/src/config/runtime-config.ts). */
export function runtimeConfig(props: Pick<WebHostingProps, 'pipelineApiBase'>): {
  pipelineApiBase: string | null;
} {
  return { pipelineApiBase: props.pipelineApiBase };
}

/**
 * Viewer-request function on the app behaviour: extension-less paths get index.html so client-side
 * routes load the app. It replaces distribution-wide 403/404 error responses, which would also turn a
 * missing basemap object, or an /api/* error, into index.html with status 200.
 */
export const SPA_ROUTING_FUNCTION = `function handler(event) {
  var request = event.request;
  var last = request.uri.substring(request.uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

const IMMUTABLE = s3deploy.CacheControl.fromString('public, max-age=31536000, immutable');
const REVALIDATE = s3deploy.CacheControl.fromString('no-cache');
const BASEMAP_CACHE = s3deploy.CacheControl.fromString('public, max-age=604800');

/**
 * The public URL: one S3 bucket (private, read through origin access control) behind one CloudFront
 * distribution serving the SPA, /config.json, the self-hosted basemap and, under `/api/*`, the CRM API
 * (metagross items 1, 2, 11), so the browser calls the API on its own origin: no CORS, no URL to configure.
 */
export class WebHosting extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebHostingProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Holds only build output and the basemap; kept on stack deletion (docs/runbook.md, teardown).
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const connectOrigins = props.pipelineApiBase ? [new URL(props.pipelineApiBase).origin] : [];
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Roofing CRM: CSP, HSTS and browser feature policy',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: contentSecurityPolicy({
            connectOrigins,
            upgradeInsecureRequests: true,
          }),
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true },
        ],
      },
    });

    const spaRouting = new cloudfront.Function(this, 'SpaRouting', {
      code: cloudfront.FunctionCode.fromInline(SPA_ROUTING_FUNCTION),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Serve index.html for extension-less app paths',
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Roofing CRM',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [
          { function: spaRouting, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        // PMTiles reads byte ranges of one archive; nothing on this path may be compressed or rewritten.
        [`${BASEMAP_PREFIX}/*`]: {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED_FOR_UNCOMPRESSED_OBJECTS,
          responseHeadersPolicy: securityHeaders,
          compress: false,
        },
        // The CRM API: never cached, every viewer header but Host forwarded, so the HTTP API sees
        // the method, body, query and content type the browser sent. HTTPS only: a redirect would
        // turn a POST into a GET.
        'api/*': {
          origin: new origins.HttpOrigin(props.apiOriginDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            readTimeout: Duration.seconds(30),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
          compress: true,
        },
      },
    });

    // One log group, 90 days, for the deployment helper Lambda (metagross item 15).
    const deployLogs = new logs.LogGroup(this, 'DeploymentLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const common = {
      destinationBucket: this.bucket,
      logGroup: deployLogs,
      outputObjectKeys: false,
      memoryLimit: 1024,
    };

    // Hashed bundles, cached for a year. Only assets/* is synced here, and older bundles are kept so a
    // page loaded just before a deploy can still fetch its own files.
    const assets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      ...common,
      sources: [s3deploy.Source.asset(props.webDistDir)],
      exclude: ['*'],
      include: ['assets/*'],
      prune: false,
      cacheControl: [IMMUTABLE],
    });

    // index.html, favicon and the runtime config: revalidated on every load, invalidated per deploy,
    // and written after the bundles they reference.
    const entry = new s3deploy.BucketDeployment(this, 'DeployEntry', {
      ...common,
      sources: [
        s3deploy.Source.asset(props.webDistDir),
        s3deploy.Source.jsonData('config.json', runtimeConfig(props)),
      ],
      exclude: ['assets/*', `${BASEMAP_PREFIX}/*`],
      cacheControl: [REVALIDATE],
      distribution: this.distribution,
      distributionPaths: ['/index.html', '/config.json', '/favicon.svg'],
    });
    entry.node.addDependency(assets);

    // The extract, glyphs, sprites and SOURCE.json (which Protomaps build and assets commit they are).
    if (props.basemapDir !== null) {
      new s3deploy.BucketDeployment(this, 'DeployBasemap', {
        ...common,
        sources: [s3deploy.Source.asset(props.basemapDir)],
        destinationKeyPrefix: `${BASEMAP_PREFIX}/`,
        cacheControl: [BASEMAP_CACHE],
        ephemeralStorageSize: Size.gibibytes(2),
        distribution: this.distribution,
        distributionPaths: [`/${BASEMAP_PREFIX}/*`],
      });
    }
  }
}
