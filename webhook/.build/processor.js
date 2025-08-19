import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, } from "@aws-sdk/lib-dynamodb";
import { publishEvent } from "./libs/events";
import { localAwsConfig } from "./aws-local";
// ---------- config
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(localAwsConfig()));
const DRIVER_TABLE = process.env.DRIVER_STATE_TABLE;
const ARRIVE_RADIUS_M = parseInt(process.env.ARRIVE_RADIUS_M ?? "150", 10);
const DEPART_EXIT_RADIUS_M = parseInt(process.env.DEPART_EXIT_RADIUS_M ?? "200", 10);
const ARRIVE_MAX_SPEED_KPH = parseInt(process.env.ARRIVE_MAX_SPEED_KPH ?? "15", 10);
const DEPART_MIN_SPEED_KPH = parseInt(process.env.DEPART_MIN_SPEED_KPH ?? "8", 10);
const ARRIVE_DWELL_PINGS = parseInt(process.env.ARRIVE_DWELL_PINGS ?? "2", 10);
const DEPART_DWELL_PINGS = parseInt(process.env.DEPART_DWELL_PINGS ?? "2", 10);
// local simulator API
const SIM_API = process.env.SIM_API_URL ?? "http://localhost:4001";
// ---------- ddb helpers (driver state only)
const getDriver = async (driverId) => (await ddb.send(new GetCommand({ TableName: DRIVER_TABLE, Key: { driverId } })))?.Item;
const putDriver = (state) => ddb.send(new PutCommand({ TableName: DRIVER_TABLE, Item: state }));
async function updateDriver(driverId, updates) {
    const names = { "#version": "version" };
    const values = { ":v0": 0, ":one": 1 };
    const sets = ["#version = if_not_exists(#version, :v0) + :one"];
    for (const [k, v] of Object.entries(updates)) {
        names[`#${k}`] = k;
        values[`:${k}`] = v;
        sets.unshift(`#${k} = :${k}`);
    }
    await ddb.send(new UpdateCommand({
        TableName: DRIVER_TABLE,
        Key: { driverId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
    }));
}
// ---------- simulator API helpers
async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok)
        return undefined;
    return res.json();
}
// Map simulator route → internal
function toInternalRoute(r) {
    const stops = (r.stops ?? [])
        .sort((a, b) => a.sequence - b.sequence)
        .map(s => ({
        id: s.id,
        type: s.type,
        lat: s.location.lat,
        lng: s.location.lng,
        radiusM: s.radiusM,
    }));
    return { routeId: r.id, driverId: r.driverId, stops, status: r.status, updatedAt: r.updatedAt };
}
// Get route by id (try /routes/:id; fallback to /routest/:id if needed)
async function getRoute(routeId) {
    const main = await fetchJson(`${SIM_API}/routes/${routeId}`);
    const sim = main ?? (await fetchJson(`${SIM_API}/routest/${routeId}`)); // tolerate typo
    return sim ? toInternalRoute(sim) : undefined;
}
// Find a “current” route for a driver:
// - prefer EN_ROUTE
// - else PLANNED (earliest by updatedAt if present)
// - ignore COMPLETED/CANCELLED
async function getCurrentRouteForDriver(driverId) {
    const simDriver = await fetchJson(`${SIM_API}/drivers/${driverId}`);
    if (!simDriver)
        return undefined;
    const simRoutes = await fetchJson(`${SIM_API}/drivers/${driverId}/routes`);
    if (!simRoutes || simRoutes.length === 0)
        return undefined;
    const candidates = simRoutes.filter(r => r.status === "EN_ROUTE" || r.status === "PLANNED");
    if (candidates.length === 0)
        return undefined;
    const pick = candidates.find(r => r.status === "EN_ROUTE") ??
        candidates
            .filter(r => r.status === "PLANNED")
            .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))[0];
    return pick ? toInternalRoute(pick) : undefined;
}
// ---------- geo
function haversineMeters(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371e3;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
const insideStopRadius = (stop, lat, lon) => haversineMeters({ lat, lon }, { lat: stop.lat, lon: stop.lng }) <= (stop.radiusM ?? ARRIVE_RADIUS_M);
// ---------- gps handler
async function handleGps(p) {
    await publishEvent("gps.received", { eventId: p.eventId, driverId: p.driverId }, "logistics.ingest");
    // ensure driver state exists
    let state = await getDriver(p.driverId);
    if (!state) {
        state = { driverId: p.driverId, phase: "IDLE", insideCount: 0, outsideCount: 0, version: 0 };
        await putDriver(state);
    }
    // save last position
    await updateDriver(p.driverId, { lastLat: p.lat, lastLon: p.lng, lastUpdateAt: p.deviceTs });
    state = { ...state, lastLat: p.lat, lastLon: p.lng, lastUpdateAt: p.deviceTs, version: state.version + 1 };
    // ensure we have a route in state (lightweight selection)
    let route;
    if (state.routeId) {
        route = await getRoute(state.routeId);
    }
    else {
        const current = await getCurrentRouteForDriver(p.driverId);
        if (current) {
            await updateDriver(p.driverId, {
                routeId: current.routeId,
                currentStopIndex: 0,
                phase: "ENROUTE",
            });
            state = { ...state, routeId: current.routeId, currentStopIndex: 0, phase: "ENROUTE" };
            route = current;
        }
    }
    if (!route || !route.stops?.length || state.currentStopIndex === undefined)
        return;
    const idx = Math.min(state.currentStopIndex, route.stops.length - 1);
    const stop = route.stops[idx];
    const speed = p.speedKph ?? 0;
    const isInside = insideStopRadius(stop, p.lat, p.lng);
    const nextInside = isInside ? (state.insideCount ?? 0) + 1 : 0;
    const nextOutside = isInside ? 0 : (state.outsideCount ?? 0) + 1;
    await updateDriver(p.driverId, { insideCount: nextInside, outsideCount: nextOutside });
    state = { ...state, insideCount: nextInside, outsideCount: nextOutside, version: state.version + 1 };
    if (state.phase !== "AT_STOP") {
        const arrived = isInside && speed <= ARRIVE_MAX_SPEED_KPH && nextInside >= ARRIVE_DWELL_PINGS;
        if (arrived) {
            await updateDriver(p.driverId, { phase: "AT_STOP", arrivedAt: p.deviceTs, outsideCount: 0 });
            state = { ...state, phase: "AT_STOP", arrivedAt: p.deviceTs, outsideCount: 0 };
            await publishEvent(stop.type === "PICKUP" ? "driver.arrived.pickup" : "driver.arrived.delivery", { eventId: p.eventId, driverId: p.driverId, routeId: state.routeId, stopId: stop.id, stopIndex: idx, lat: p.lat, lng: p.lng, occurredAt: p.deviceTs });
        }
    }
    else {
        const departed = !isInside && speed >= DEPART_MIN_SPEED_KPH && nextOutside >= DEPART_DWELL_PINGS;
        if (departed) {
            const nextIdx = idx + 1;
            const completed = nextIdx >= route.stops.length;
            await updateDriver(p.driverId, {
                phase: completed ? "COMPLETED" : "ENROUTE",
                departedAt: p.deviceTs,
                currentStopIndex: completed ? idx : nextIdx,
                insideCount: 0,
            });
            state = {
                ...state,
                phase: completed ? "COMPLETED" : "ENROUTE",
                departedAt: p.deviceTs,
                currentStopIndex: completed ? idx : nextIdx,
                insideCount: 0,
                version: state.version + 1,
            };
            await publishEvent("driver.departed.stop", {
                eventId: p.eventId, driverId: p.driverId, routeId: state.routeId, stopId: stop.id, stopIndex: idx, occurredAt: p.deviceTs
            });
        }
    }
}
// ---------- lambda entry
export const handler = async (event) => {
    for (const rec of event.Records) {
        try {
            const msg = JSON.parse(rec.body);
            if (msg.type === "gps")
                await handleGps(msg.payload);
            else
                console.warn("Ignoring non-gps message:", msg.type);
        }
        catch (err) {
            console.error("Record failed", err);
            throw err; // retry → DLQ
        }
    }
};
