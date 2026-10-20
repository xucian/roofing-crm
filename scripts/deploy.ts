// Deploys the RoofingCrm stack from the operator's machine. CI never deploys (decisions.md, 2026-10-16).
//
//   pnpm deploy:aws [--yes]
//
// The pipeline API base is `apiBase` in packages/pipeline-client/openapi.pin.json (committed, not a
// secret); PIPELINE_API_BASE in the environment overrides it. Nothing is read from .env. Steps: refuse
// without the pinned pipeline contract -> check that the API serves that contract -> show the AWS
// identity and region -> check the CDK bootstrap -> check the basemap -> build -> cdk deploy -> print
// the URL and the F1 link.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  DEFAULT_CENTER,
  RADIUS_MILES,
  ROOF_AGE_THRESHOLD_YEARS,
  normalizePipelineApiBase,
} from '@roofing-crm/shared';
import { REPO_ROOT, capture, fail, pnpm, run } from './lib/run';

const REGION = 'us-east-2';
const STACK = 'RoofingCrm';
const API_DIR = join(REPO_ROOT, 'apps/api');
const BASEMAP_DIR = join(REPO_ROOT, 'basemap');
const OUTPUTS_FILE = join(REPO_ROOT, 'cdk-outputs.json');
const PIN_FILE = join(REPO_ROOT, 'packages/pipeline-client/openapi.pin.json');

interface PinFile {
  apiBase?: string;
  commit: string | null;
}

const readPinFile = (): PinFile => JSON.parse(readFileSync(PIN_FILE, 'utf8')) as PinFile;

function pipelineApiBase(pin: PinFile): string {
  const override = process.env.PIPELINE_API_BASE;
  if (override !== undefined) {
    console.log('PIPELINE_API_BASE is set and overrides apiBase in openapi.pin.json.');
  }
  const value = override ?? pin.apiBase;
  if (value === undefined) {
    fail('packages/pipeline-client/openapi.pin.json has no apiBase (the pipeline API_BASE).');
  }
  try {
    return normalizePipelineApiBase(value);
  } catch (error) {
    return fail(`Pipeline API base: ${(error as Error).message}`);
  }
}

function requirePinnedContract(pin: PinFile): void {
  if (pin.commit === null) {
    fail(
      'The pipeline contract pin is pending (packages/pipeline-client/openapi.pin.json): F1 cannot run before the pipeline commits openapi.json (its T7) and the client is generated from it.',
    );
  }
}

function buildCommit(): string {
  const commit = capture('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT }) ?? 'unknown';
  const dirty = (capture('git', ['status', '--porcelain'], { cwd: REPO_ROOT }) ?? '') !== '';
  return dirty ? `${commit}-dirty` : commit;
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false } } });

  const pin = readPinFile();
  requirePinnedContract(pin);
  const apiBase = pipelineApiBase(pin);
  console.log(`Pipeline API: ${apiBase}`);
  pnpm(['--filter', '@roofing-crm/pipeline-client', 'check:served'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PIPELINE_API_BASE: apiBase },
  });

  if (capture('aws', ['--version']) === null) fail('The AWS CLI v2 is required (aws --version).');
  const identityText = capture('aws', ['sts', 'get-caller-identity', '--output', 'json']);
  if (identityText === null)
    fail('No AWS credentials: select the deploy profile (export AWS_PROFILE=...) and retry.');
  const identity = JSON.parse(identityText) as { Account: string; Arn: string };
  console.log(`AWS account ${identity.Account} as ${identity.Arn}, region ${REGION}`);

  const toolkit = capture('aws', [
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'CDKToolkit',
    '--region',
    REGION,
    '--query',
    'Stacks[0].StackStatus',
    '--output',
    'text',
  ]);
  if (toolkit === null) {
    fail(
      `The account is not bootstrapped for CDK in ${REGION}. Run once:\n  pnpm --filter @roofing-crm/api exec cdk bootstrap aws://${identity.Account}/${REGION}`,
    );
  }

  if (!existsSync(join(BASEMAP_DIR, 'travis.pmtiles'))) {
    fail('basemap/travis.pmtiles is missing. Run `pnpm basemap` first.');
  }

  if (
    !values.yes &&
    !(await confirm(`Deploy ${STACK} to ${identity.Account}/${REGION} against ${apiBase}?`))
  ) {
    fail('Cancelled.');
  }

  const commit = buildCommit();
  pnpm(['install', '--frozen-lockfile'], { cwd: REPO_ROOT });
  pnpm(['turbo', 'run', 'build', '--filter=@roofing-crm/web'], {
    cwd: REPO_ROOT,
    env: { ...process.env, VITE_BUILD_COMMIT: commit },
  });

  run(
    join(API_DIR, 'node_modules/.bin/cdk'),
    [
      'deploy',
      STACK,
      '--require-approval',
      'broadening',
      '--outputs-file',
      OUTPUTS_FILE,
      '-c',
      `pipelineApiBase=${apiBase}`,
      '-c',
      `basemapDir=${BASEMAP_DIR}`,
      '-c',
      'requireDeployInputs=true',
    ],
    { cwd: API_DIR },
  );

  const outputs = (
    JSON.parse(readFileSync(OUTPUTS_FILE, 'utf8')) as Record<string, Record<string, string>>
  )[STACK];
  const webUrl = outputs?.WebUrl;
  if (!webUrl) fail(`Deployed, but ${OUTPUTS_FILE} has no WebUrl output.`);
  const link = `${webUrl}/?lat=${DEFAULT_CENTER.lat.toFixed(5)}&lon=${DEFAULT_CENTER.lon.toFixed(5)}&radius=${String(RADIUS_MILES.default)}&age=${String(ROOF_AGE_THRESHOLD_YEARS.default)}`;
  console.log(`\nDeployed build ${commit}.`);
  console.log(`  URL:            ${webUrl}`);
  console.log(`  F1 link:        ${link}`);
  console.log(`  Distribution:   ${outputs.DistributionId ?? '?'}`);
  console.log(`  Bucket:         ${outputs.WebBucketName ?? '?'}`);
  console.log('Next: the F1 check in docs/progress.md (open the link, then the three AWS steps).');
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
