import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { localAwsConfig } from '../aws-local';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(localAwsConfig()));
const TABLE = process.env.EVENT_TABLE!;

export async function seenEvent(eventId: string, ttlSeconds = 60 * 60 * 24) {
  const get = await ddb.send(new GetCommand({ TableName: TABLE, Key: { eventId } }));
  if (get.Item) return true;

  const now = Math.floor(Date.now() / 1000);
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { eventId, ttl: now + ttlSeconds },
    ConditionExpression: 'attribute_not_exists(eventId)'
  }));
  return false;
}
