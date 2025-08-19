import { nanoid } from 'nanoid';
import type { Driver, Route, Stop, LatLng } from './types.js';

const drivers = new Map<string, Driver>();
const routes = new Map<string, Route>();

export function seedDriver(name: string) {
  const id = nanoid();
  const d: Driver = { id, name };
  drivers.set(id, d);
  return d;
}

export function listDrivers() {
  return [...drivers.values()];
}

export function createRoute(input: {
  driverId: string; shipmentId?: string; stops: Array<Omit<Stop, 'id'>>;
}) {
  if (!drivers.has(input.driverId)) throw new Error('driver not found');
  const id = nanoid();
  const stops: Stop[] = input.stops
    .map((s, i) => ({ ...s, id: nanoid(), sequence: s.sequence ?? i + 1, radiusM: s.radiusM ?? 100 }));
  const r: Route = {
    id,
    driverId: input.driverId,
    shipmentId: input.shipmentId ?? `SHP-${Math.random().toString(36).slice(2, 8)}`,
    status: 'PLANNED',
    stops
  };
  routes.set(id, r);
  return r;
}

export function assignRouteToDriver(routeId: string) {
  const r = routes.get(routeId);
  if (!r) throw new Error('route not found');
  r.status = 'EN_ROUTE';
  return r;
}

export function completeRoute(routeId: string) {
  const r = routes.get(routeId);
  if (!r) throw new Error('route not found');
  r.status = 'COMPLETED';
  return r;
}

export function getRoute(id: string) { return routes.get(id); }
export function listRoutes() { return [...routes.values()]; }


/** Minimal TMS surface your poller can call */
export const TMSApi = {
  // GET /tms/assignments?since=ISO
  assignmentsSince(since?: string) {
    // For the mock we ignore "since" and return EN_ROUTE + PLANNED
    return listRoutes().filter(r => r.status === 'PLANNED' || r.status === 'EN_ROUTE');
  },
  // GET /tms/shipments/:id
  getShipment(routeId: string) { return getRoute(routeId); },
  // utility to quickly seed demo data
  quickSeed: (driverName: string, from: LatLng, to: LatLng) => {
    const d = seedDriver(driverName);
    const route = createRoute({
      driverId: d.id,
      stops: [
        { sequence: 1, type: 'PICKUP', name: 'Origin', location: from },
        { sequence: 2, type: 'DELIVERY', name: 'Destination', location: to }
      ]
    });
    return { driver: d, route };
  }
};



export function randomInRadius(center: LatLng, radiusKm: number): LatLng {
  // naive equirectangular offset (ok for city-scale sims)
  const r = radiusKm * 1000;
  const u = Math.random();
  const v = Math.random();
  const w = r * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const dx = w * Math.cos(t);
  const dy = w * Math.sin(t);
  const dLat = (dy / 111_320);                     // meters per deg lat
  const dLng = (dx / (111_320 * Math.cos(center.lat * Math.PI/180)));
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

const names = ['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Heidi','Ivan','Judy','Mallory','Niaj','Olivia','Peggy','Sybil','Trent','Victor','Wendy'];
export function randomName() { return names[Math.floor(Math.random()*names.length)] + '-' + Math.floor(Math.random()*1000); }

export function seedDriverWithTwoStopRoute(center: LatLng, radiusKm = 8) {
  const d = seedDriver(randomName());
  const from = randomInRadius(center, radiusKm);
  const to   = randomInRadius(center, radiusKm);
  const r = createRoute({
    driverId: d.id,
    stops: [
      { sequence: 1, type: 'PICKUP', name: 'Origin', location: from, radiusM: 120 },
      { sequence: 2, type: 'DELIVERY', name: 'Destination', location: to, radiusM: 120 }
    ]
  });
  return { driver: d, route: r };
}
