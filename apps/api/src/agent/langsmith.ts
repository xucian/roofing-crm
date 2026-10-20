import { createHash } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AGENT_NAME } from '@roofing-crm/shared';
import * as ai from 'ai';
import { Client } from 'langsmith/client';
import { createLangSmithProviderOptions, wrapAISDK } from 'langsmith/experimental/vercel';

/**
 * The kit's LangSmith facade (build-ai-agents, rules/observability-langsmith-telemetry.md; alakazam
 * item 15), as in the pipeline agent: a traced `ToolLoopAgent`, `flush()` before every answer, and
 * graceful degradation: no key, an unreadable secret or a wrapper error gives the plain AI SDK, never
 * a failed turn. The key is the Secrets Manager secret LANGSMITH_API_KEY_SECRET_ID names, read at
 * run time and cached for the instance; a local run may set LANGSMITH_API_KEY. Traces hold the
 * question and the answer (docs/runbook.md); the client-sent history reaches them only as hashes.
 */
export interface LangSmithFacade {
  tracingEnabled: boolean;
  ToolLoopAgent: typeof ai.ToolLoopAgent;
  providerOptions: (
    metadata: Record<string, string | number | boolean>,
  ) => Record<string, ai.JSONValue>;
  /** Sends the pending trace batches, waiting at most `maxMs`; never throws. */
  flush: (maxMs: number) => Promise<void>;
}

export const PLAIN_FACADE: LangSmithFacade = {
  tracingEnabled: false,
  ToolLoopAgent: ai.ToolLoopAgent,
  providerOptions: () => ({}),
  flush: () => Promise.resolve(),
};

/** Keys whose values never reach a trace; the tools never return them, this is the backstop. */
const PERSON_KEYS = new Set(['owner_name', 'mailing_address', 'applicant']);

/** The current turn's client-sent history, hidden in traces as hashes. One turn per instance. */
const history = new Map<string, string>();

export function registerHistory(contents: string[]): void {
  for (const content of contents) {
    if (content.trim().length >= 4) {
      const digest = createHash('sha256').update(content).digest('hex').slice(0, 16);
      history.set(content, `[earlier message sha256:${digest}]`);
    }
  }
}

export function clearHistory(): void {
  history.clear();
}

/** Deep copy with the earlier messages replaced by their hashes and person fields hidden. */
export function hideForTrace(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = history.get(value) ?? value;
    for (const [content, label] of history) {
      if (content !== value && out.includes(content)) out = out.split(content).join(label);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(hideForTrace);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = item !== null && PERSON_KEYS.has(key) ? '[hidden]' : hideForTrace(item);
    }
    return out;
  }
  return value;
}

export interface LangSmithEnv {
  LANGSMITH_TRACING?: string | undefined;
  LANGSMITH_PROJECT?: string | undefined;
  LANGSMITH_ENDPOINT?: string | undefined;
  LANGSMITH_API_KEY?: string | undefined;
  LANGSMITH_API_KEY_SECRET_ID?: string | undefined;
  AWS_REGION?: string | undefined;
}

export type SecretReader = (secretId: string, region: string | undefined) => Promise<string>;

export const readSecretFromSecretsManager: SecretReader = async (secretId, region) => {
  const client = new SecretsManagerClient({
    ...(region ? { region } : {}),
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 1000, requestTimeout: 1000 },
  });
  const answer = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = answer.SecretString?.trim();
  if (!value) throw new Error('the LangSmith secret is empty');
  return value;
};

async function build(env: LangSmithEnv, readSecret: SecretReader): Promise<LangSmithFacade> {
  if ((env.LANGSMITH_TRACING ?? 'true') !== 'true') return PLAIN_FACADE;
  let key = env.LANGSMITH_API_KEY?.trim();
  if (!key && env.LANGSMITH_API_KEY_SECRET_ID) {
    key = await readSecret(env.LANGSMITH_API_KEY_SECRET_ID, env.AWS_REGION);
  }
  if (!key) return PLAIN_FACADE;
  const project = env.LANGSMITH_PROJECT ?? AGENT_NAME;
  // The wrapper reads the project and endpoint from the environment.
  process.env.LANGSMITH_PROJECT = project;
  process.env.LANGSMITH_TRACING = 'true';
  if (env.LANGSMITH_ENDPOINT) process.env.LANGSMITH_ENDPOINT = env.LANGSMITH_ENDPOINT;
  const client = new Client({
    apiKey: key,
    ...(env.LANGSMITH_ENDPOINT ? { apiUrl: env.LANGSMITH_ENDPOINT } : {}),
    hideInputs: (inputs) => hideForTrace(inputs) as Record<string, unknown>,
    hideOutputs: (outputs) => hideForTrace(outputs) as Record<string, unknown>,
  });
  const wrapped = wrapAISDK(ai, { client, project_name: project });
  return {
    tracingEnabled: true,
    ToolLoopAgent: wrapped.ToolLoopAgent,
    providerOptions: (metadata) =>
      createLangSmithProviderOptions<typeof ai.generateText>({
        name: `${AGENT_NAME} turn`,
        metadata,
      }),
    flush: async (maxMs) => {
      if (maxMs <= 0) return;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        client.awaitPendingTraceBatches().catch(() => undefined),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, maxMs))),
      ]);
      clearTimeout(timer);
    },
  };
}

/** One facade per instance; a failure to build it gives the plain AI SDK for that instance. */
export function langSmithLoader(
  env: LangSmithEnv,
  readSecret: SecretReader = readSecretFromSecretsManager,
  onError: (error: unknown) => void = () => undefined,
): () => Promise<LangSmithFacade> {
  let cached: Promise<LangSmithFacade> | null = null;
  return () => {
    cached ??= build(env, readSecret).catch((error: unknown) => {
      onError(error);
      return PLAIN_FACADE;
    });
    return cached;
  };
}
