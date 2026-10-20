import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { USAGE_PARTITION, createDailyUsage, utcDay } from './usage';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' }));
const mock = mockClient(doc);
const usage = createDailyUsage(doc, 'Leads', { turns: 200, tokens: 2_000_000 });

beforeEach(() => {
  mock.reset();
});

describe('the daily chat budget', () => {
  it('counts a turn in the day item while both caps hold', async () => {
    mock.on(UpdateCommand).resolves({});
    await expect(usage.take('2026-10-21')).resolves.toBe(true);
    expect(mock.commandCalls(UpdateCommand)[0]?.args[0].input).toEqual({
      TableName: 'Leads',
      Key: { workspace_id: USAGE_PARTITION, lead_key: '2026-10-21' },
      UpdateExpression: 'ADD turns :one',
      ConditionExpression:
        '(attribute_not_exists(turns) OR turns < :turns) AND (attribute_not_exists(tokens) OR tokens < :tokens)',
      ExpressionAttributeValues: { ':one': 1, ':turns': 200, ':tokens': 2_000_000 },
    });
  });

  it('refuses a turn once a cap is reached', async () => {
    mock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'cap', $metadata: {} }));
    await expect(usage.take('2026-10-21')).resolves.toBe(false);
  });

  it("adds a turn's tokens, and counts in UTC days", async () => {
    mock.on(UpdateCommand).resolves({});
    await usage.addTokens('2026-10-21', 1234);
    await usage.addTokens('2026-10-21', 0);
    expect(mock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(mock.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
      UpdateExpression: 'ADD tokens :tokens',
      ExpressionAttributeValues: { ':tokens': 1234 },
    });
    expect(utcDay(new Date('2026-10-21T23:59:59-05:00'))).toBe('2026-10-22');
  });
});
