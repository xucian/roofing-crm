import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  LEAD_LIST_PAGE,
  LeadSchema,
  leadKey,
  type Lead,
  type LeadPage,
  type LeadStatus,
} from '@roofing-crm/shared';

/**
 * The table (docs/decisions.md §5, metagross entry): partition key `workspace_id`, sort key
 * `lead_key` = `<property_id>#<permit_id>`. One item per lead; its attributes are the Lead's fields.
 */
export const TABLE_KEYS = { partition: 'workspace_id', sort: 'lead_key' } as const;

export type PutOutcome = { created: true; lead: Lead } | { created: false; lead: Lead };

/** The fields an edit may set; the snapshot and the keys never change. */
export interface LeadPatch {
  status?: LeadStatus | undefined;
  note?: string | undefined;
}

/** A list page, and how many leads were read to fill it (more than it holds when filtering). */
export interface ListedPage extends LeadPage {
  scanned: number;
}

/**
 * A filtered list reads at most this many leads per request. A page that would need more ends
 * early with a cursor, so a large workspace cannot keep one request reading.
 */
export const LIST_SCAN_MAX = 10 * LEAD_LIST_PAGE.max;

export interface LeadRepository {
  get(workspaceId: string, key: string): Promise<Lead | null>;
  /** Writes the lead unless one with its key exists; then returns that one, unchanged. */
  putNew(workspaceId: string, lead: Lead): Promise<PutOutcome>;
  /** Up to `limit` leads that `matches` keeps, in sort-key order, from after the cursor. */
  list(
    workspaceId: string,
    cursor: string | null,
    limit: number,
    matches?: (lead: Lead) => boolean,
  ): Promise<ListedPage>;
  /** Sets the patch's fields and `updated_at`; null when there is no such lead (nothing written). */
  update(
    workspaceId: string,
    key: string,
    patch: LeadPatch,
    updatedAt: string,
  ): Promise<Lead | null>;
  /** Deletes the lead and returns it; null when there was none. */
  delete(workspaceId: string, key: string): Promise<Lead | null>;
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

    // DynamoDB's own FilterExpression would cost the same reads; the predicate is shared with the
    // browser instead (docs/decisions.md, F4 entry). The cursor is the stored sort key of the last lead read.
    async list(workspaceId, cursor, limit, matches = () => true) {
      const items: Lead[] = [];
      let after = cursor === null ? null : decodeCursor(cursor);
      let scanned = 0;
      for (;;) {
        const { Items = [], LastEvaluatedKey } = await doc.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: '#partition = :workspace',
            ExpressionAttributeNames: { '#partition': TABLE_KEYS.partition },
            ExpressionAttributeValues: { ':workspace': workspaceId },
            Limit: limit,
            ...(after === null
              ? {}
              : {
                  ExclusiveStartKey: {
                    [TABLE_KEYS.partition]: workspaceId,
                    [TABLE_KEYS.sort]: after,
                  },
                }),
          }),
        );
        for (const [index, item] of Items.entries()) {
          const lead = parseLead(item);
          scanned += 1;
          if (matches(lead)) items.push(lead);
          const lastOfTable = index === Items.length - 1 && LastEvaluatedKey === undefined;
          if (items.length === limit || (scanned >= LIST_SCAN_MAX && !lastOfTable)) {
            return { items, next_cursor: lastOfTable ? null : encodeCursor(item), scanned };
          }
        }
        if (LastEvaluatedKey === undefined) return { items, next_cursor: null, scanned };
        after = LastEvaluatedKey[TABLE_KEYS.sort] as string;
      }
    },

    async update(workspaceId, key, patch, updatedAt) {
      const names: Record<string, string> = { '#sort': TABLE_KEYS.sort, '#updated': 'updated_at' };
      const values: Record<string, unknown> = { ':updated': updatedAt };
      const sets = ['#updated = :updated'];
      if (patch.status !== undefined) {
        names['#status'] = 'status';
        values[':status'] = patch.status;
        sets.push('#status = :status');
      }
      if (patch.note !== undefined) {
        names['#note'] = 'note';
        values[':note'] = patch.note;
        sets.push('#note = :note');
      }
      try {
        const { Attributes } = await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { [TABLE_KEYS.partition]: workspaceId, [TABLE_KEYS.sort]: key },
            UpdateExpression: `SET ${sets.join(', ')}`,
            // Never create a lead here: an edit of a deleted lead changes nothing.
            ConditionExpression: 'attribute_exists(#sort)',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW',
          }),
        );
        return Attributes ? parseLead(Attributes) : null;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return null;
        throw error;
      }
    },

    async delete(workspaceId, key) {
      const { Attributes } = await doc.send(
        new DeleteCommand({
          TableName: table,
          Key: { [TABLE_KEYS.partition]: workspaceId, [TABLE_KEYS.sort]: key },
          ReturnValues: 'ALL_OLD',
        }),
      );
      return Attributes ? parseLead(Attributes) : null;
    },
  };
}
