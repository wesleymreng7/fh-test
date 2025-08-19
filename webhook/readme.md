# 📄 Technical Implementation Report – Logistics Event Processing System

## 1. Overview
The goal of this project was to design and implement a **serverless event-driven system** that processes real-time logistics data from multiple sources (webhooks and TMS polling), disambiguates events (pickup vs delivery), and triggers **location-based notifications**.

Due to time constraints, not all debugging and best practices could be fully applied, but the core architecture, reasoning behind design choices, and future improvements are documented here.

---

## 2. Architecture & Components

### 2.1 Data Sources
- **Webhooks**: Real-time GPS pings and mobile app events.
- **TMS Polling**: Periodic sync of route and shipment information.

### 2.2 Event Ingestion
- **API Gateway / Lambda (Webhook Processor)**: Receives external events and pushes them into a queue.
- **EventBridge Scheduler (TMS Poller)**: Triggers periodic Lambda to fetch data from TMS.

### 2.3 Event Processing
- **SQS Queue**: Ensures async, reliable delivery of events.
- **Processor Lambda**:
  - Normalizes events into a canonical schema.
  - Applies validation and basic enrichment.
  - Writes results into DynamoDB.

### 2.4 State & Storage
- **DynamoDB**:
  - Stores drivers, routes, and event states.
  - Schema optimized for fast lookups by `driverId` and route context.

### 2.5 Geospatial Logic
- Haversine-based distance calculation between driver’s current location and pickup/delivery coordinates.
- Threshold radius (e.g., 100m) used to infer arrival events.

### 2.6 Notifications
- **SNS Topic**: Publishes notifications when arrival/delivery events are detected.
- Consumers could be mobile apps, monitoring dashboards, or external systems.

### 2.7 Simulator
- A **custom simulator** was built to generate realistic driver GPS pings.
- **Intention**: Provide a controllable, repeatable data stream for testing ingestion, processing, and geospatial logic without needing live GPS hardware.
- **Aspects**:
  - Interpolates route legs with configurable speed, jitter, and step resolution.
  - Supports multiple drivers running concurrently.
  - Helped validate end-to-end flow but still has room for improvements (e.g., better emulation of network delays, out-of-order events).

---

## 3. Technical Decisions & Rationale

- **Serverless (Lambda + EventBridge + SQS)**  
  - Pros: Scalability, reduced ops overhead, pay-per-use.  
  - Cons: Cold start latency, local debugging challenges.  
  - Rationale: Event-driven nature fits perfectly with Lambda + queues.  

- **DynamoDB**  
  - Chosen for **low-latency lookups** on driver states and ability to handle high write throughput.  
  - Trade-off: More complex schema design compared to relational DBs.  

- **Canonical Event Schema**  
  - Simplifies processing by normalizing different sources (GPS vs TMS).  
  - Could evolve into a versioned schema for long-term maintainability.  

- **Geospatial Distance Check (Haversine)**  
  - Chosen for simplicity and speed.  
  - Not as precise as full geospatial indexing (e.g., PostGIS), but good enough for this use case.  

- **Simulator**  
  - Allowed fast prototyping and testing without external dependencies.  
  - Essential for validating assumptions on event ingestion and geospatial thresholds.  

---

## 4. Known Limitations & Improvements

### 4.1 Event Processing
- ❌ Currently minimal error handling (retries, DLQs not fully implemented).
- ✅ Should add **Dead Letter Queues** and structured retry policies.

### 4.2 DynamoDB Schema
- ❌ Schema is still basic, some queries required **multiple conditions → ValidationException**.
- ✅ Would refine partition/sort keys for better access patterns.

### 4.3 Debugging & Local Dev
- ❌ LocalStack used for testing, but some issues with API Gateway + Lambda integration.
- ✅ Could add better mocks, integration tests, and CI pipeline with infra tests.

### 4.4 Geospatial Logic
- ❌ Simple radius check only; doesn’t handle **edge cases** (e.g., urban canyons, multiple stops close together).
- ✅ Could integrate with **AWS Location Service** or a geospatial DB for higher accuracy.

### 4.5 Observability
- ❌ Limited logging/metrics.
- ✅ Should add CloudWatch dashboards, X-Ray traces, and structured logs.

### 4.6 Simulator
- ❌ Events are currently too deterministic unless jitter is applied.
- ✅ Could improve by simulating GPS noise, offline intervals, and bulk event replays to better stress-test the system.

---

## 5. Next Steps
1. Refactor DynamoDB schema to avoid composite key errors.
2. Add DLQs, retries, and error alerting.
3. Improve local dev with Docker + LocalStack integration tests.
4. Enhance geospatial disambiguation with more advanced algorithms.
5. Add full CI/CD pipeline with IaC (Serverless Framework or CDK).
6. Expand simulator capabilities for stress and chaos testing.

---


## 6. Testing
To test the system end-to-end:

1. **Start the local environment**  
  Run the following command to spin up LocalStack and supporting services:
  ```bash
  bash start.sh
  ```

2. **Obtain the webhook endpoint**  
  After startup, note the output for the webhook endpoint, which should look similar to:
  ```
  http://localhost:4566/restapis/xexieepbng/local/_user_request_
  ```

3. **Send a test event**  
  Use `curl` or a similar tool to POST a sample GPS event:
  ```bash
  curl -X POST http://localhost:4566/restapis/xexieepbng/local/_user_request_/webhooks/gps \
    -H "Content-Type: application/json" \
    -d '{
     "eventId": "dVnxGkY6JQ8JYijv51x36",
     "driverId": "a2ucwo1mwzuNVfzzN-7xG",
     "lat": -23.492121863538213,
     "lng": -46.66627090907898,
     "speedKph": 10,
     "timestamp": "2025-08-18T23:10:56.490Z"
    }'
  ```

4. **Verify processing**  
  - Check logs and DynamoDB tables in LocalStack to confirm the event was ingested and processed.
  - Observe any notifications or downstream effects as configured.

This process validates the ingestion, normalization, and storage pipeline using a realistic event payload.