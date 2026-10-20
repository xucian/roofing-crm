import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Lead } from '@roofing-crm/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { WORKSPACE } from '../test/helpers';
import { InvalidCursor, createLeadRepository, decodeCursor, encodeCursor } from './repository';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' }));
const mock = mockClient(doc);
const repository = createLeadRepository(doc, 'Leads');

const lead: Lead = {
  lead_id: '01JBQ80000000000000000000A',
  property_id: 'fx-1',
  permit_id: 'FX-1 BP',
  status: 'new',
  note: '',
  snapshot: {
    taken_at: '2026-10-20T12:00:00.000Z',
    run_id: 'fixture-run',
    address: { line1: '1 FIXTURE ST', city: 'TESTVILLE', zip: '00000' },
    lat: 30.25,
    lon: -97.75,
    roof_age_years: 36,
    roof_year: 1990,
    roof_age_basis: 'year_built',
    roofing_permit_counts: { open: 1, stalled: 0, closed: 0, needs_review: 0 },
    permit: null,
  },
  created_at: '2026-10-20T12:00:00.000Z',
  updated_at: '2026-10-20T12:00:00.000Z',
};
const item = { ...lead, workspace_id: WORKSPACE, lead_key: 'fx-1#FX-1 BP' };

beforeEach(() => {
  mock.reset();
});

describe('LeadRepository', () => {
  it('writes a new lead with a conditional put on its key', async () => {
    mock.on(PutCommand).resolves({});
    await expect(repository.putNew(WORKSPACE, lead)).resolves.toEqual({ created: true, lead });
    expect(mock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'Leads',
      Item: item,
      ConditionExpression: 'attribute_not_exists(#sort)',
      ExpressionAttributeNames: { '#sort': 'lead_key' },
    });
  });

  it('returns the lead another request wrote first, unchanged', async () => {
    const earlier = { ...item, lead_id: '01JBQ80000000000000000000B' };
    mock
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'exists', $metadata: {} }));
    mock.on(GetCommand).resolves({ Item: earlier });
    const outcome = await repository.putNew(WORKSPACE, lead);
    expect(outcome).toEqual({ created: false, lead: { ...lead, lead_id: earlier.lead_id } });
    expect(mock.commandCalls(GetCommand)[0]?.args[0].input).toMatchObject({
      Key: { workspace_id: WORKSPACE, lead_key: 'fx-1#FX-1 BP' },
      ConsistentRead: true,
    });
  });

  it('reads one lead by key, without the table keys', async () => {
    mock.on(GetCommand).resolves({ Item: item });
    await expect(repository.get(WORKSPACE, 'fx-1#FX-1 BP')).resolves.toEqual(lead);
    mock.on(GetCommand).resolves({});
    await expect(repository.get(WORKSPACE, 'fx-2#')).resolves.toBeNull();
  });

  it("lists a page of the workspace's leads and continues from an opaque cursor", async () => {
    mock.on(QueryCommand).resolvesOnce({
      Items: [item],
      LastEvaluatedKey: { workspace_id: WORKSPACE, lead_key: 'fx-1#FX-1 BP' },
    });
    const page = await repository.list(WORKSPACE, null, 1);
    expect(page.items).toEqual([lead]);
    expect(page.next_cursor).not.toBeNull();
    expect(mock.commandCalls(QueryCommand)[0]?.args[0].input).toEqual({
      TableName: 'Leads',
      KeyConditionExpression: '#partition = :workspace',
      ExpressionAttributeNames: { '#partition': 'workspace_id' },
      ExpressionAttributeValues: { ':workspace': WORKSPACE },
      Limit: 1,
    });

    mock.on(QueryCommand).resolves({ Items: [] });
    const next = await repository.list(WORKSPACE, page.next_cursor, 1);
    expect(next).toEqual({ items: [], next_cursor: null });
    expect(mock.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
      workspace_id: WORKSPACE,
      lead_key: 'fx-1#FX-1 BP',
    });
  });

  it('refuses a cursor it did not issue', () => {
    expect(decodeCursor(encodeCursor({ lead_key: 'a#' }) ?? '')).toBe('a#');
    expect(() => decodeCursor('not-a-cursor')).toThrow(InvalidCursor);
    expect(() => decodeCursor(Buffer.from('{"k":3}').toString('base64url'))).toThrow(InvalidCursor);
  });
});
