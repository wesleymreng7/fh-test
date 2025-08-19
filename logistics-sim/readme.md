# Logistics Simulator – Swarm & API Usage Guide

This guide shows how to run the multi‑driver **swarm** and the main HTTP endpoints exposed by the simulator service.

> Repo layout assumed:
>
> ```
> logistics-sim/
>   .env                # set WEBHOOK_URL, PORT, DEFAULT_INTERVAL_MS
>   src/
>     server.ts         # Express app + routes
>     sim.ts            # GPS simulator
>     tms.ts            # Mock TMS data
> ```

---

## 1) Prerequisites & Setup

1. **Install**

   ```bash
   pnpm i
   cp .env.example .env
   # edit .env → WEBHOOK_URL=http://localhost:4000/webhook (your real webhook)
   ```
2. **Run**

   ```bash
   pnpm dev
   # server logs: "sim listening on :4001 → webhook=..."
   ```
3. **Health check**

   ```bash
   curl http://localhost:4001/health
   ```

### Environment variables

* `WEBHOOK_URL` – where GPS pings are POSTed
* `PORT` – server port (default **4001**)
* `DEFAULT_INTERVAL_MS` – default tick interval for single‑runner starts (fallback)

---

## 2) Swarm – Seed and Start Many Drivers

Start **N** drivers with random two‑stop routes around a center point; each driver emits GPS pings to your `WEBHOOK_URL`.

### `POST /swarm/start`

Starts a swarm.

**Body**

```json
{
  "drivers": 50,
  "center": { "lat": -23.5505, "lng": -46.6333 },
  "radiusKm": 12,
  "intervalMsRange": [900, 2000],
  "speedKphRange": [20, 60],
  "stepsPerLeg": 40,
  "jitterMs": 500
}
```

* `drivers` (int) – number of concurrent drivers (1–1000; default 25)
* `center` (LatLng) – geographic center for generating stops (defaults to São Paulo)
* `radiusKm` – randomization radius for origins/destinations (default 10)
* `intervalMsRange` – per‑driver tick interval range
* `speedKphRange` – per‑driver simulated speed
* `stepsPerLeg` – path resolution (higher = smoother + more pings)
* `jitterMs` – random +ms added to each tick to avoid lockstep

**Response**

```json
{
  "started": 50,
  "items": [
    { "driverId": "dr_...", "routeId": "rt_...", "runnerId": "run_..." }
  ]
}
```

**Example**

```bash
curl -s -X POST http://localhost:4001/swarm/start \
  -H 'content-type: application/json' \
  -d '{
    "drivers": 5,
    "center": {"lat": -23.5505, "lng": -46.6333},
    "radiusKm": 12,
    "intervalMsRange": [900, 2000],
    "speedKphRange": [20, 60],
    "stepsPerLeg": 40,
    "jitterMs": 500
  }' | jq '.started'
```

### `POST /swarm/stop`

Stops all active runners.

```bash
curl -X POST http://localhost:4001/swarm/stop
```

---

## 3) Simulator – Single/Manual Control

### `POST /simulate/gps/start`

Start a runner for an existing route.

**Body**

```json
{ "routeId": "<ROUTE_ID>", "intervalMs": 1500, "speedKph": 35 }
```

**Response** `{ "runnerId": "..." }`

### `POST /simulate/gps/stop`

Stop a specific runner.

**Body** `{ "runnerId": "..." }`

### `GET /simulate/gps/runners`

List active runners with progress.

### `POST /simulate/gps/once`

Send a single GPS ping to the webhook.

**Body**

```json
{ "driverId": "<DRIVER_ID>", "lat": -23.55, "lng": -46.63, "speedKph": 30 }
```

---

## 4) Quick Data Seeding

### `POST /seed/quick`

Creates a driver with a two‑stop route and marks it `EN_ROUTE`.

**Body**

```json
{
  "driverName": "Alice",
  "from": { "lat": -23.5505, "lng": -46.6333 },
  "to":   { "lat": -23.6219, "lng": -46.6990 }
}
```

**Response** `{ "driver": {..}, "route": {..} }`

---

## 5) Mock TMS Endpoints (for your Poller)

### `GET /tms/assignments?since=<ISO>`

Returns current assignments (mock returns `PLANNED` + `EN_ROUTE` routes).

**Example**

```bash
curl http://localhost:4001/tms/assignments | jq
```

### `GET /tms/shipments/:id`

Returns full route (stops, types, coordinates) by id.

```bash
curl http://localhost:4001/tms/shipments/<ROUTE_ID> | jq
```

---

## 6) Drivers & Routes CRUD (minimal)

* `POST /drivers` → `{ name }` → **201** driver
* `GET /drivers` → list
* `POST /routes` → `{ driverId, shipmentId?, stops[] }` → **201** route
* `POST /routes/:id/assign` → sets status `EN_ROUTE`
* `GET /routes` / `GET /routes/:id`

**Stop object** (used in `stops[]`):

```json
{
  "sequence": 1,
  "type": "PICKUP",            // or DELIVERY
  "name": "Origin",
  "location": { "lat": -23.55, "lng": -46.63 },
  "radiusM": 120
}
```

---

## 7) Webhook Payload Shape (what your API receives)

```json
{
  "driverId": "<UUID>",
  "lat": -23.5505,
  "lng": -46.6333,
  "speedKph": 40,
  "timestamp": "2025-08-17T03:10:00.000Z"
}
```

> Your webhook should respond **202 Accepted** quickly and forward this into EventBridge (or your chosen bus) with idempotency.

---

## 8) Docker (optional)

```bash
docker build -t logistics-sim .
# host.docker.internal lets the container reach your host webhook
docker run --rm -p 4001:4001 \
  -e WEBHOOK_URL="http://host.docker.internal:4000/webhook" logistics-sim
```

---

## 9) Troubleshooting & Tips

* **Nothing hitting my webhook?** Verify `WEBHOOK_URL`, check network/firewall, and inspect simulator logs.
* **Too many requests at once?** Increase `jitterMs` and widen `intervalMsRange`.
* **Make routes longer**: increase `stepsPerLeg` or extend `seedDriverWithTwoStopRoute` to 3–5 stops.
* **Replayable tests**: persist seeded drivers/routes to a file or DB and expose `/swarm/start-existing` (easy extension).

---

## 10) Quick Demo Script

```bash
# Start 20 drivers around São Paulo with varied speeds
curl -s -X POST http://localhost:4001/swarm/start \
  -H 'content-type: application/json' \
  -d '{"drivers":20,"radiusKm":8,"intervalMsRange":[1200,2200],"speedKphRange":[25,55],"stepsPerLeg":35,"jitterMs":450}'

# Observe
watch -n 2 curl -s http://localhost:4001/simulate/gps/runners | jq

# Stop everyone
curl -X POST http://localhost:4001/swarm/stop
```
