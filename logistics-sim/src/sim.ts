import fetch from 'node-fetch';
import { nanoid } from 'nanoid';
import type { LatLng, GpsPing, Route } from './types.js';

export type SimTunables = {
  intervalMs?: number;              // default per-runner interval
  jitterMs?: number;                // random +[0..jitter] per tick (default 300)
  stepsPerLeg?: number;             // path resolution (default 30)
  speedKph?: number;                // default 40
  reducedSpeedKph?: number;            // default 20
  reducedSpeedRadiusKm?: number;       // default 0.5
};

type Runner = {
  id: string;
  driverId: string;
  routeId: string;
  active: boolean;
  timer?: NodeJS.Timeout;
  i: number;
  path: LatLng[];
  tunables: Required<SimTunables>;
};

const runners = new Map<string, Runner>();

// Great-circle linear interpolation (good enough for a sim)
function interpolate(a: LatLng, b: LatLng, steps: number): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return pts;
}

function buildPathForRoute(route: Route, stepsPerLeg = 30) {
  const legs: LatLng[] = [];
  for (let i = 0; i < route.stops.length - 1; i++) {
    const a = route.stops[i].location;
    const b = route.stops[i + 1].location;
    const seg = interpolate(a, b, stepsPerLeg);
    if (i > 0) seg.shift();
    legs.push(...seg);
  }
  return legs;
}

export function startRunner(params: {
  webhookUrl: string;
  route: Route;
  driverId: string;
  tunables: SimTunables;
}) {
  const t: Required<SimTunables> = {
    intervalMs: params.tunables?.intervalMs ?? 2000,
    jitterMs: params.tunables?.jitterMs ?? 300,
    stepsPerLeg: params.tunables?.stepsPerLeg ?? 30,
    speedKph: params.tunables?.speedKph ?? 40,
    reducedSpeedKph: params.tunables?.reducedSpeedKph ?? 20,
    reducedSpeedRadiusKm: params.tunables?.reducedSpeedRadiusKm ?? 0.5
  };
  const id = nanoid();
  const path = buildPathForRoute(params.route);
  const runner: Runner = {
    id,
    driverId: params.driverId,
    routeId: params.route.id,
    active: true,
    i: 0,
    path,
    tunables: t
  };

  const tick = async () => {
    if (!runner.active) return;
    if (runner.i >= runner.path.length) { runner.active = false; return; }
    const p = runner.path[runner.i++];
    let speedKph = t.speedKph;

    // Reduce speed if leaving the first point or stopping at the last one
    if (runner.i === 1 || runner.i === runner.path.length) {
      speedKph = t.reducedSpeedKph;
    }

    const payload: GpsPing = {
      eventId: nanoid(),
      driverId: runner.driverId,
      lat: p.lat,
      lng: p.lng,
      speedKph: speedKph,
      timestamp: new Date().toISOString()
    };
    console.log(payload);
    try {
      await fetch(params.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // swallow errors to keep sim going
      // eslint-disable-next-line no-console
      console.error('webhook post failed', (e as Error).message);
    } finally {
      runner.timer = setTimeout(tick, runner.tunables.intervalMs + Math.floor(Math.random() * 300)); // small jitter
    }
  };

  runners.set(id, runner);
  runner.timer = setTimeout(tick, 50);
  return { runnerId: id };
}

export function stopRunner(runnerId: string) {
  const r = runners.get(runnerId);
  if (!r) return false;
  r.active = false;
  if (r.timer) clearTimeout(r.timer);
  runners.delete(runnerId);
  return true;
}

export function stopAllRunners() {
  for (const id of [...runners.keys()]) stopRunner(id);
  return true;
}

export function listRunners() {
  return [...runners.values()].map(r => ({
    id: r.id, driverId: r.driverId, routeId: r.routeId, active: r.active,
    progress: `${r.i}/${r.path.length}`, intervalMs: r.tunables.intervalMs
  }));
}
