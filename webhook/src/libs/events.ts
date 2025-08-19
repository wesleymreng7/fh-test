import type { PutEventsCommandInput } from "@aws-sdk/client-eventbridge";
import { localAwsConfig } from "../aws-local";

export type DomainEventType =
  | "gps.received" | "tms.updated"
  | "driver.arrived.pickup" | "driver.arrived.delivery"
  | "driver.departed.stop";

type Publisher = (type: DomainEventType, detail: Record<string, any>, source?: string) => Promise<void>;

let publishEvent: Publisher = async () => { /* no-op for MVP */ };

const initializeEventPublisher = async () => {
  if (process.env.EVENT_BUS_NAME) {
    const { EventBridgeClient, PutEventsCommand } = await import("@aws-sdk/client-eventbridge");
    const eb = new EventBridgeClient(localAwsConfig());
    const BUS = process.env.EVENT_BUS_NAME!;
    publishEvent = async (type, detail, source = "logistics.detector") => {
      const input: PutEventsCommandInput = {
        Entries: [{ EventBusName: BUS, Source: source, DetailType: type, Detail: JSON.stringify(detail) }]
      };
      await eb.send(new PutEventsCommand(input));
    };
  }
};

initializeEventPublisher();

export { publishEvent };
