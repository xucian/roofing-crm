// Deploys the RoofingCrm stack from the operator's machine. CI never deploys (decisions.md, 2026-10-16).
//
//   pnpm deploy:aws [--yes]
//
// The pipeline API base is `apiBase` in packages/pipeline-client/openapi.pin.json (committed, not a
// secret); PIPELINE_API_BASE in the environment overrides it. From .env only LANGSMITH_API_KEY is
// read. Steps: refuse without the pinned pipeline contract -> check that the API serves that contract
// -> show the AWS identity and region -> check the CDK bootstrap -> check the basemap -> write the
// LangSmith key to Secrets Manager -> build -> cdk deploy -> subscribe an email to the alarm topic
// once -> print the URL, the F1 link and the API's resources.
//
// The LangSmith key (F5) goes from .env to the secret `pidgeot-agent/langsmith-api-key` with the AWS
// CLI, through a file only this user can read, so it is in neither argv, the template, git nor the
// logs; CDK gets the secret's name and the agent reads the key at run time. Without a key the agent
// answers untraced.
//
// The alarm email is the operator's, so it stays out of git and out of the template: ALERT_EMAIL, or
// a prompt the first time, subscribes it with the AWS CLI. Later deploys find the subscription and
// leave it alone.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const ENV_FILE = join(REPO_ROOT, '.env');
export const LANGSMITH_SECRET_NAME = 'pidgeot-agent/langsmith-api-key';

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

async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

async function confirm(question: string): Promise<boolean> {
  return /^y(es)?$/i.test(await ask(`${question} [y/N] `));
}

interface Subscription {
  Protocol: string;
  Endpoint: string;
  SubscriptionArn: string;
}

/** One email subscription on the alarm topic, made outside CloudFormation (see the header). */
async function ensureAlertEmail(topicArn: string, interactive: boolean): Promise<void> {
  const listed = capture('aws', [
    'sns',
    'list-subscriptions-by-topic',
    '--topic-arn',
    topicArn,
    '--region',
    REGION,
    '--output',
    'json',
  ]);
  if (listed === null) {
    console.log(`Could not list the subscriptions of ${topicArn}; alarm email left as it is.`);
    return;
  }
  const emails = (JSON.parse(listed) as { Subscriptions: Subscription[] }).Subscriptions.filter(
    (subscription) => subscription.Protocol === 'email',
  );
  if (emails.length > 0) {
    const pending = emails.some(
      (subscription) => subscription.SubscriptionArn === 'PendingConfirmation',
    );
    console.log(
      `Alarm email: ${String(emails.length)} subscription(s)${pending ? ', one still waiting for its confirmation link' : ''}.`,
    );
    return;
  }
  const email =
    process.env.ALERT_EMAIL?.trim() ??
    (interactive ? await ask('Email address for the CRM alarms (blank to skip): ') : '');
  if (email === '') {
    console.log('No alarm email subscribed: the alarms change state but notify nobody.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) fail(`Not an email address: ${email}`);
  run('aws', [
    'sns',
    'subscribe',
    '--topic-arn',
    topicArn,
    '--protocol',
    'email',
    '--notification-endpoint',
    email,
    '--region',
    REGION,
    '--output',
    'text',
  ]);
  console.log('AWS has sent a confirmation email: open it and click "Confirm subscription".');
}

/** LANGSMITH_API_KEY from the environment or .env; nothing else is read from .env. */
function langsmithKey(): string | null {
  const fromEnv = process.env.LANGSMITH_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(ENV_FILE)) return null;
  const line = readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('LANGSMITH_API_KEY='));
  const value = line
    ?.slice('LANGSMITH_API_KEY='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
  return value === undefined || value === '' ? null : value;
}

/**
 * Creates or updates the LangSmith key's secret (a new version only when the key changed); returns
 * the secret's name for CDK, or null when there is no key.
 */
function ensureLangsmithSecret(): string | null {
  const key = langsmithKey();
  if (key === null) {
    console.log('No LANGSMITH_API_KEY in .env: the agent will answer without LangSmith traces.');
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), 'roofing-crm-'));
  const file = join(dir, 'secret');
  try {
    writeFileSync(file, key, { mode: 0o600 });
    const current = capture('aws', [
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      LANGSMITH_SECRET_NAME,
      '--region',
      REGION,
      '--query',
      'SecretString',
      '--output',
      'text',
    ]);
    if (current === key) {
      console.log(`LangSmith key: ${LANGSMITH_SECRET_NAME} is up to date.`);
    } else if (current === null) {
      run(
        'aws',
        [
          'secretsmanager',
          'create-secret',
          '--name',
          LANGSMITH_SECRET_NAME,
          '--description',
          'LangSmith API key of the Roofing CRM agent (pidgeot-agent); written by pnpm deploy:aws',
          '--secret-string',
          `file://${file}`,
          '--tags',
          'Key=project_name,Value=roofing-crm',
          '--region',
          REGION,
          '--query',
          'Name',
          '--output',
          'text',
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      console.log(`LangSmith key: created ${LANGSMITH_SECRET_NAME}.`);
    } else {
      run(
        'aws',
        [
          'secretsmanager',
          'put-secret-value',
          '--secret-id',
          LANGSMITH_SECRET_NAME,
          '--secret-string',
          `file://${file}`,
          '--region',
          REGION,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      console.log(`LangSmith key: updated ${LANGSMITH_SECRET_NAME}.`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return LANGSMITH_SECRET_NAME;
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

  const langsmithSecretName = ensureLangsmithSecret();
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
      ...(langsmithSecretName ? ['-c', `langsmithSecretName=${langsmithSecretName}`] : []),
    ],
    { cwd: API_DIR },
  );

  const outputs = (
    JSON.parse(readFileSync(OUTPUTS_FILE, 'utf8')) as Record<string, Record<string, string>>
  )[STACK];
  const webUrl = outputs?.WebUrl;
  if (!webUrl) fail(`Deployed, but ${OUTPUTS_FILE} has no WebUrl output.`);
  if (outputs.AlertsTopicArn) await ensureAlertEmail(outputs.AlertsTopicArn, !values.yes);

  const link = `${webUrl}/?lat=${DEFAULT_CENTER.lat.toFixed(5)}&lon=${DEFAULT_CENTER.lon.toFixed(5)}&radius=${String(RADIUS_MILES.default)}&age=${String(ROOF_AGE_THRESHOLD_YEARS.default)}`;
  console.log(`\nDeployed build ${commit}.`);
  console.log(`  URL:            ${webUrl}`);
  console.log(`  F1 link:        ${link}`);
  console.log(`  Leads page:     ${webUrl}/leads`);
  console.log(`  Distribution:   ${outputs.DistributionId ?? '?'}`);
  console.log(`  Bucket:         ${outputs.WebBucketName ?? '?'}`);
  console.log(`  CRM API:        ${outputs.ApiId ?? '?'} (behind ${webUrl}/api/trpc)`);
  console.log(`  Leads function: ${outputs.LeadsFunctionName ?? '?'}`);
  console.log(`  Function logs:  ${outputs.LeadsLogGroup ?? '?'}`);
  console.log(`  Access logs:    ${outputs.ApiAccessLogGroup ?? '?'}`);
  console.log(`  Leads table:    ${outputs.LeadsTableName ?? '?'}`);
  console.log(
    `  Agent function: ${outputs.AgentFunctionName ?? '?'} (${outputs.BedrockModelId ?? '?'})`,
  );
  console.log(`  Agent logs:     ${outputs.AgentLogGroup ?? '?'}`);
  console.log(`  Dashboard:      ${outputs.DashboardName ?? '?'}`);
  console.log(`  Assistant:      ${webUrl}/assistant`);
  console.log("Next: the current piece's handoff in docs/progress.md.");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
