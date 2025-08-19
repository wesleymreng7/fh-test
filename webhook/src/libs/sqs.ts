import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { localAwsConfig } from "../aws-local";


const client = new SQSClient(localAwsConfig());
const QUEUE_URL = process.env.SQS_QUEUE_URL!;

export async function enqueue(type: "gps" | "tms", payload: any, groupId?: string) {
  const body = JSON.stringify({ type, payload, receivedAt: new Date().toISOString() });

  const params: any = { QueueUrl: QUEUE_URL, MessageBody: body };

  if (QUEUE_URL.endsWith(".fifo")) {
    params.MessageGroupId = groupId ?? (payload.driverId ?? type);
    params.MessageDeduplicationId = payload.eventId ?? `${type}-${Date.now()}`;
  }

  await client.send(new SendMessageCommand(params));
}
