import { localAwsConfig } from "../aws-local";
let publishEvent = async () => { };
const initializeEventPublisher = async () => {
    if (process.env.EVENT_BUS_NAME) {
        const { EventBridgeClient, PutEventsCommand } = await import("@aws-sdk/client-eventbridge");
        const eb = new EventBridgeClient(localAwsConfig());
        const BUS = process.env.EVENT_BUS_NAME;
        publishEvent = async (type, detail, source = "logistics.detector") => {
            const input = {
                Entries: [{ EventBusName: BUS, Source: source, DetailType: type, Detail: JSON.stringify(detail) }]
            };
            await eb.send(new PutEventsCommand(input));
        };
    }
};
initializeEventPublisher();
export { publishEvent };
