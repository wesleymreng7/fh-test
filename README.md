# Event Driven App

> High‑level plan to validate the logistics serverless system (Node.js + TypeScript, Serverless, LocalStack, DynamoDB, SQS, EventBridge, Simulator API).

## Components

* **Poller**: reads drivers/routes from Simulator API and upserts routes; assigns drivers.
* **Processor**: consumes GPS events from SQS, updates DriverState, emits domain events.
* **Event layer**: publishes domain events
* **Persistence**: DynamoDB tables `DriverStateTable` (PK driverId), `RoutesTable` (PK routeId), `EventIdempotencyTable` (PK eventId, TTL).
* **Simulator API**: `/drivers`, `/routes`, `/routes/:id`, `/drivers/:id/routes`.
