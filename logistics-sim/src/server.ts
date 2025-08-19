import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { nanoid } from 'nanoid';
import { TMSApi, seedDriver, createRoute, assignRouteToDriver, listDrivers, listRoutes, getRoute, seedDriverWithTwoStopRoute, randomInRadius } from './tms.js';
import { startRunner, stopRunner, stopAllRunners, listRunners, type SimTunables } from './sim.js';
import type { LatLng, Stop } from './types.js';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = Number(process.env.PORT ?? 4001);
const WEBHOOK_URL = process.env.WEBHOOK_URL!;
const DEFAULT_INTERVAL_MS = Number(process.env.DEFAULT_INTERVAL_MS ?? 2000);

// --- Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Quick seed demo (driver + simple route)
app.post('/seed/quick', (req, res) => {
  const { driverName = 'Driver One', from, to } = req.body as { driverName?: string; from: LatLng; to: LatLng; };
  if (!from || !to) return res.status(400).json({ error: 'from/to required' });
  const { driver, route } = TMSApi.quickSeed(driverName, from, to);
  assignRouteToDriver(route.id);
  res.json({ driver, route });
});

// --- Drivers
app.post('/drivers', (req, res) => {
  const d = seedDriver(req.body.name ?? `Driver-${nanoid(4)}`);
  res.status(201).json(d);
});
app.get('/drivers', (_req, res) => res.json(listDrivers()));
app.get('/drivers/:id', (req, res) => {
  const driver = listDrivers().find(d => d.id === req.params.id);
  if (!driver) return res.status(404).json({ error: 'not found' });
  res.json(driver);
});

// --- Routes
app.post('/routes', (req, res) => {
  const { driverId, shipmentId, stops } = req.body as { driverId: string; shipmentId?: string; stops: Omit<Stop, 'id'>[] };
  try {
    const r = createRoute({ driverId, shipmentId, stops });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.post('/routes/:id/assign', (req, res) => {
  try {
    const r = assignRouteToDriver(req.params.id);
    res.json(r);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});
app.get('/routes', (_req, res) => res.json(listRoutes()));
app.get('/routes/:id', (req, res) => {
  const r = getRoute(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});

app.get('/drivers/:driverId/routes', (req, res) => {
  const routes = listRoutes().filter(r => r.driverId === req.params.driverId);
  res.json(routes);
});
// --- Simulator controls (fires to your WEBHOOK_URL)
app.post('/simulate/gps/start', (req, res) => {
  const { routeId, intervalMs, speedKph } = req.body as { routeId: string; intervalMs?: number; speedKph?: number; };
  const route = getRoute(routeId);
  if (!route) return res.status(404).json({ error: 'route not found' });
  const { runnerId } = startRunner({
    webhookUrl: WEBHOOK_URL,
    route,
    driverId: route.driverId,
    tunables: {
      intervalMs: intervalMs ?? DEFAULT_INTERVAL_MS,
      speedKph: speedKph ?? 40
    }
  });
  res.json({ runnerId });
});
app.post('/simulate/gps/stop', (req, res) => {
  const { runnerId } = req.body as { runnerId: string };
  const ok = stopRunner(runnerId);
  res.json({ stopped: ok });
});
app.get('/simulate/gps/runners', (_req, res) => res.json(listRunners()));

// --- Fire one-off GPS ping
app.post('/simulate/gps/once', async (req, res) => {
  const { driverId, lat, lng, speedKph } = req.body as { driverId: string; lat: number; lng: number; speedKph?: number; };
  const payload = { driverId, lat, lng, speedKph, timestamp: new Date().toISOString() };
  const r = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  res.json({ status: r.status });
});

// --- Mock TMS endpoints (for your poller)
app.get('/tms/assignments', (req, res) => {
  res.json({ items: TMSApi.assignmentsSince(req.query.since as string | undefined) });
});
app.get('/tms/shipments/:id', (req, res) => {
  const ship = TMSApi.getShipment(req.params.id);
  if (!ship) return res.status(404).json({ error: 'not found' });
  res.json(ship);
});

// --- Swarm: seed N drivers+routes and start all runners
app.post('/swarm/start', (req, res) => {
  const body = req.body as {
    drivers?: number;
    center?: { lat: number; lng: number };
    radiusKm?: number;
    intervalMsRange?: [number, number];
    speedKphRange?: [number, number];
    stepsPerLeg?: number;
    jitterMs?: number;
    reducedSpeedKph?: number;
    reducedSpeedRadiusKm?: number;
  };

  const driversCount = Math.max(1, Math.min(1000, body.drivers ?? 25));
  const center = body.center ?? { lat: -23.5505, lng: -46.6333 }; // São Paulo center default
  const radiusKm = body.radiusKm ?? 10;
  const intervalRange = body.intervalMsRange ?? [1200, 2500];
  const speedRange = body.speedKphRange ?? [25, 55];
  const reducedSpeedKph = body.reducedSpeedKph ?? speedRange[0] / 2; // Default to half the minimum speed
  const reducedSpeedRadiusKm = body.reducedSpeedRadiusKm ?? 0.5; // Default to 500 meters

  const seeded: Array<{ driverId: string; routeId: string; runnerId: string }> = [];
  for (let i = 0; i < driversCount; i++) {
    const { driver, route } = seedDriverWithTwoStopRoute(center, radiusKm);
    assignRouteToDriver(route.id);

    const tunables: SimTunables = {
      intervalMs: Math.floor(intervalRange[0] + Math.random() * (intervalRange[1] - intervalRange[0])),
      jitterMs: body.jitterMs ?? 400,
      stepsPerLeg: body.stepsPerLeg ?? 30,
      speedKph: Math.floor(speedRange[0] + Math.random() * (speedRange[1] - speedRange[0])),
      reducedSpeedKph,
      reducedSpeedRadiusKm
    };

    const { runnerId } = startRunner({ webhookUrl: WEBHOOK_URL, route, driverId: driver.id, tunables });
    seeded.push({ driverId: driver.id, routeId: route.id, runnerId });
  }

  res.json({ started: seeded.length, items: seeded });
});

// --- Swarm: stop everybody
app.post('/swarm/stop', (_req, res) => {
  stopAllRunners();
  res.json({ stopped: true });
});


app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sim listening on :${PORT} → webhook=${WEBHOOK_URL}`);
});
