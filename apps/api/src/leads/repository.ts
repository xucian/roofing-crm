import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { LeadSchema, leadKey, type Lead, type LeadPage } from '@roofing-crm/shared';

/**
 * The table (docs/decisions.md §5, metagross entry): partition key `workspace_id`, sort key
 * `lead_key` = `<property_id>#<permit_id>`. One item per lead; its attributes are the Lead's fields.
 */
export const TABLE_KEYS = { partition: 'workspace_id', sort: 'lead_key' } as const;

export type PutOutcome = { created: true; lead: Lead } | { created: false; lead: Lead };

export interface LeadRepository {
  get(workspaceId: string, key: string): Promise<Lead | null>;
  /** Writes the lead unless one with its key exists; then returns that one, unchanged. */
  putNew(workspaceId: string, lead: Lead): Promise<PutOutcome>;
  list(workspaceId: string, cursor: string | null, limit: number): Promise<LeadPage>;
}

/** A list cursor that is not one this function issued for this workspace. */
export class InvalidCursor extends Error {
  override readonly name = 'InvalidCursor';
}

const parseLead = (item: Record<string, unknown>): Lead => LeadSchema.parse(item);

/** Cursors are opaque to the browser: the last sort key read, base64url-encoded. */
export function encodeCursor(lastKey: Record<string, unknown> | undefined): string | null {
  const key = lastKey?.[TABLE_KEYS.sort];
  if (typeof key !== 'string') return null;
  return Buffer.from(JSON.stringify({ k: key }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursor('The cursor is not one this API issued.');
  }
  const key = (value as { k?: unknown } | null)?.k;
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new InvalidCursor('The cursor is not one this API issued.');
  }
  return key;
}

export function createLeadRepository(doc: DynamoDBDocumentClient, table: string): LeadRepository {
  const get = async (workspaceId: string, key: string): Promise<Lead | null> => {
    const { Item } = await doc.send(
      new GetCommand({
        TableName: table,
        Key: { [TABLE_KEYS.partition]: workspaceId, [TABLE_KEYS.sort]: key },
        ConsistentRead: true,
      }),
    );
    return Item ? parseLead(Item) : null;
  };

  return {
    get,

    async putNew(workspaceId, lead) {
      const key = leadKey(lead);
      try {
        await doc.send(
          new PutCommand({
            TableName: table,
            Item: { ...lead, [TABLE_KEYS.partition]: workspaceId, [TABLE_KEYS.sort]: key },
            ConditionExpression: 'attribute_not_exists(#sort)',
            ExpressionAttributeNames: { '#sort': TABLE_KEYS.sort },
          }),
        );
        return { created: true, lead };
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
        // Another request created it between our read and this write: that one stands.
        const existing = await get(workspaceId, key);
        if (!existing) throw error;
        return { created: false, lead: existing };
      }
    },

    async list(workspaceId, cursor, limit) {
      const { Items = [], LastEvaluatedKey } = await doc.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: '#partition = :workspace',
          ExpressionAttributeNames: { '#partition': TABLE_KEYS.partition },
          ExpressionAttributeValues: { ':workspace': workspaceId },
          Limit: limit,
          ...(cursor === null
            ? {}
            : {
                ExclusiveStartKey: {
                  [TABLE_KEYS.partition]: workspaceId,
                  [TABLE_KEYS.sort]: decodeCursor(cursor),
                },
              }),
        }),
      );
      return { items: Items.map(parseLead), next_cursor: encodeCursor(LastEvaluatedKey) };
    },
  };
}
