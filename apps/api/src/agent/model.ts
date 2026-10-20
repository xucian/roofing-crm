import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { withBedrockPromptCaching, type CacheUsage } from './bedrock-prompt-cache';

/**
 * The agent's model (docs/decisions.md, 2026-10-20 F5 entry): the US cross-region inference profile
 * BEDROCK_MODEL_ID names, Claude Sonnet 4.6 by default, called with the function role's credentials
 * and wrapped with prompt caching before any agent sees it (the kit's rule).
 */
export const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

export function bedrockModel(
  modelId: string,
  region = process.env.AWS_REGION ?? 'us-east-2',
  onCacheUsage?: (usage: CacheUsage) => void,
) {
  const bedrock = createAmazonBedrock({ region });
  return withBedrockPromptCaching(bedrock(modelId), onCacheUsage);
}
