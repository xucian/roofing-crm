import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { TABLE_KEYS } from '../leads/repository';

/**
 * The agent's daily budget (docs/decisions.md §3: a public endpoint bounds its model spend): at most
 * `turns` turns and `tokens` model tokens per UTC day, counted in one item of the leads table. Past
 * either, chat answers 503 `budget_exhausted` until 00:00 UTC. The partition key is not a ULID, so
 * no workspace can read or write it through the lead procedures.
 */
export const USAGE_PARTITION = '#agent-usage';

export const DAILY_LIMITS = { turns: 200, tokens: 2_000_000 } as const;

export interface DailyUsage {
  /** Counts one turn; false when the day's turns or tokens are used up (nothing counted then). */
  take(day: string): Promise<boolean>;
  /** Adds a finished turn's input and output tokens. */
  addTokens(day: string, tokens: number): Promise<void>;
}

/** The UTC day a turn counts in, `2026-10-20`. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

export function createDailyUsage(
  doc: DynamoDBDocumentClient,
  table: string,
  limits: { turns: number; tokens: number } = DAILY_LIMITS,
): DailyUsage {
  const key = (day: string) => ({
    [TABLE_KEYS.partition]: USAGE_PARTITION,
    [TABLE_KEYS.sort]: day,
  });
  return {
    async take(day) {
      try {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: key(day),
            UpdateExpression: 'ADD turns :one',
            ConditionExpression:
              '(attribute_not_exists(turns) OR turns < :turns) AND (attribute_not_exists(tokens) OR tokens < :tokens)',
            ExpressionAttributeValues: {
              ':one': 1,
              ':turns': limits.turns,
              ':tokens': limits.tokens,
            },
          }),
        );
        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return false;
        throw error;
      }
    },
    async addTokens(day, tokens) {
      if (tokens <= 0) return;
      await doc.send(
        new UpdateCommand({
          TableName: table,
          Key: key(day),
          UpdateExpression: 'ADD tokens :tokens',
          ExpressionAttributeValues: { ':tokens': tokens },
        }),
      );
    },
  };
}
