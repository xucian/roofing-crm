import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Lead } from '@roofing-crm/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { WORKSPACE } from '../test/helpers';
import {
  InvalidCursor,
  LIST_SCAN_MAX,
  createLeadRepository,
  decodeCursor,
  encodeCursor,
} from './repository';

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
    expect(next).toEqual({ items: [], next_cursor: null, scanned: 0 });
    expect(mock.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
      workspace_id: WORKSPACE,
      lead_key: 'fx-1#FX-1 BP',
    });
  });

  it('fills a filtered page across queries and continues after the last lead it read', async () => {
    const at = (n: number) => ({
      ...item,
      property_id: `fx-${String(n)}`,
      lead_key: `fx-${String(n)}#`,
    });
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [at(1), at(2)], LastEvaluatedKey: { lead_key: 'fx-2#' } })
      .resolvesOnce({ Items: [at(3), at(4)], LastEvaluatedKey: { lead_key: 'fx-4#' } });
    const odd = (subject: Lead) => Number(subject.property_id.slice(3)) % 2 === 1;
    const page = await repository.list(WORKSPACE, null, 2, odd);

    expect(page.items.map((subject) => subject.property_id)).toEqual(['fx-1', 'fx-3']);
    expect(page.scanned).toBe(3);
    expect(decodeCursor(page.next_cursor ?? '')).toBe('fx-3#');
    expect(mock.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
      workspace_id: WORKSPACE,
      lead_key: 'fx-2#',
    });
  });

  it('ends a filtered page at the end of the table without a cursor', async () => {
    mock
      .on(QueryCommand)
      .resolves({ Items: [item, { ...item, lead_key: 'fx-2#', property_id: 'fx-2' }] });
    const page = await repository.list(WORKSPACE, null, 2, () => true);
    expect(page.next_cursor).toBeNull();
    const none = await repository.list(WORKSPACE, null, 2, () => false);
    expect(none).toEqual({ items: [], next_cursor: null, scanned: 2 });
  });

  it(`stops after reading ${String(LIST_SCAN_MAX)} leads and hands back a cursor`, async () => {
    const page = (start: number) =>
      Array.from({ length: 200 }, (_, i) => ({
        ...item,
        lead_key: `k${String(start + i).padStart(5, '0')}#`,
      }));
    let query = mock.on(QueryCommand);
    for (let n = 0; n < LIST_SCAN_MAX / 200; n += 1) {
      query = query.resolvesOnce({ Items: page(n * 200), LastEvaluatedKey: { lead_key: 'more' } });
    }
    const listed = await repository.list(WORKSPACE, null, 200, () => false);
    expect(listed.items).toEqual([]);
    expect(listed.scanned).toBe(LIST_SCAN_MAX);
    expect(listed.next_cursor).not.toBeNull();
    expect(mock.commandCalls(QueryCommand)).toHaveLength(LIST_SCAN_MAX / 200);
  });

  it('sets the status and the note of an existing lead and returns it as stored', async () => {
    const updated = {
      ...item,
      status: 'working',
      note: 'Call back',
      updated_at: '2026-10-21T09:00:00.000Z',
    };
    mock.on(UpdateCommand).resolves({ Attributes: updated });
    const result = await repository.update(
      WORKSPACE,
      'fx-1#FX-1 BP',
      { status: 'working', note: 'Call back' },
      '2026-10-21T09:00:00.000Z',
    );
    expect(result).toEqual({
      ...lead,
      status: 'working',
      note: 'Call back',
      updated_at: '2026-10-21T09:00:00.000Z',
    });
    expect(mock.commandCalls(UpdateCommand)[0]?.args[0].input).toEqual({
      TableName: 'Leads',
      Key: { workspace_id: WORKSPACE, lead_key: 'fx-1#FX-1 BP' },
      UpdateExpression: 'SET #updated = :updated, #status = :status, #note = :note',
      ConditionExpression: 'attribute_exists(#sort)',
      ExpressionAttributeNames: {
        '#sort': 'lead_key',
        '#updated': 'updated_at',
        '#status': 'status',
        '#note': 'note',
      },
      ExpressionAttributeValues: {
        ':updated': '2026-10-21T09:00:00.000Z',
        ':status': 'working',
        ':note': 'Call back',
      },
      ReturnValues: 'ALL_NEW',
    });
  });

  it('sets only the fields given, and never creates a lead', async () => {
    mock.on(UpdateCommand).resolves({ Attributes: { ...item, note: '' } });
    await repository.update(WORKSPACE, 'fx-1#FX-1 BP', { note: '' }, '2026-10-21T09:00:00.000Z');
    const input = mock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe('SET #updated = :updated, #note = :note');
    expect(input?.ExpressionAttributeNames).not.toHaveProperty('#status');

    mock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'missing', $metadata: {} }));
    await expect(
      repository.update(WORKSPACE, 'fx-9#', { status: 'closed' }, '2026-10-21T09:00:00.000Z'),
    ).resolves.toBeNull();
  });

  it('deletes a lead and returns it, or null when there was none', async () => {
    mock.on(DeleteCommand).resolvesOnce({ Attributes: item }).resolvesOnce({});
    await expect(repository.delete(WORKSPACE, 'fx-1#FX-1 BP')).resolves.toEqual(lead);
    expect(mock.commandCalls(DeleteCommand)[0]?.args[0].input).toEqual({
      TableName: 'Leads',
      Key: { workspace_id: WORKSPACE, lead_key: 'fx-1#FX-1 BP' },
      ReturnValues: 'ALL_OLD',
    });
    await expect(repository.delete(WORKSPACE, 'fx-1#FX-1 BP')).resolves.toBeNull();
  });

  it('refuses a cursor it did not issue', () => {
    expect(decodeCursor(encodeCursor({ lead_key: 'a#' }) ?? '')).toBe('a#');
    expect(() => decodeCursor('not-a-cursor')).toThrow(InvalidCursor);
    expect(() => decodeCursor(Buffer.from('{"k":3}').toString('base64url'))).toThrow(InvalidCursor);
  });
});
