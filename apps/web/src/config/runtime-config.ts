import { normalizePipelineApiBase } from '@roofing-crm/shared';
import { z } from 'zod';

/**
 * Deployment settings the stack writes to /config.json (metagross item 2). The bundle carries no
 * URL of its own: the same build runs against whatever pipeline API the deploy configured.
 */
export interface RuntimeConfig {
  /** The pipeline API v1 base (API_BASE), or null when the deployment has none. */
  pipelineApiBase: string | null;
}

const RuntimeConfigSchema = z.object({
  pipelineApiBase: z
    .string()
    .nullable()
    .transform((value, context) => {
      if (value === null) return null;
      try {
        return normalizePipelineApiBase(value);
      } catch (error) {
        context.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),
});

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  const result = RuntimeConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`/config.json is invalid: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchImpl('/config.json', {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`/config.json answered HTTP ${String(response.status)}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('/config.json is not JSON');
  }
  return parseRuntimeConfig(body);
}
