import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { publishEvent } from "./libs/events";
import { localAwsConfig } from "./aws-local";
import fetch from "node-fetch";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(localAwsConfig()));
const DRIVER_TABLE = process.env.DRIVER_STATE_TABLE;
const ROUTES_TABLE = process.env.ROUTES_TABLE;
const BASE = process.env.SIM_API_BASE;
const CONC = parseInt(process.env.POLLER_CONCURRENCY ?? "8", 10);
const LocationDto = z.object({
    lat: z.number(),
    lng: z.number(),
});
// --- DTOs from simulator ---
const StopDto = z.object({
    id: z.string(),
    type: z.enum(["PICKUP", "DELIVERY"]),
    location: LocationDto,
    radiusM: z.number().min(0).optional(),
    windowStart: z.string().optional(),
    windowEnd: z.string().optional(),
});
const RouteDto = z.object({
    id: z.string(),
    shipmentId: z.string().optional(),
    driverId: z.string().optional(),
    stops: z.array(StopDto),
    updatedAt: z.string().optional(),
});
const DriverDto = z.object({
    id: z.string(),
    name: z.string().optional(),
});
// --- tiny fetch helper with timeout ---
async function getJson(path, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
        if (!res.ok) {
            throw new Error(`GET ${path} ${res.status} ${await res.text()}`);
        }
        return (await res.json());
    }
    finally {
        clearTimeout(t);
    }
}
// --- DB helpers ---
async function upsertRoute(dto) {
    const stops = dto.stops.map((s, i) => ({
        id: `${dto.id}-${i}`,
        type: s.type,
        location: {
            lat: s.location.lat,
            lng: s.location.lng,
        },
        radiusM: s.radiusM,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
    }));
    const route = {
        id: dto.id,
        shipmentId: dto.shipmentId,
        driverId: dto.driverId,
        stops,
        updatedAt: dto.updatedAt ?? new Date().toISOString(),
    };
    await ddb.send(new PutCommand({
        TableName: ROUTES_TABLE,
        Item: route,
    }));
    // Optional – broadcast inventory/state to the bus for observability (no-op if bus disabled)
    await publishEvent("tms.updated", {
        routeId: route.id,
        driverId: route.driverId,
        stops: route.stops.length,
        updatedAt: route.updatedAt,
    }, "logistics.poller");
}
async function getDriverState(driverId) {
    const res = await ddb.send(new GetCommand({ TableName: DRIVER_TABLE, Key: { driverId } }));
    return res.Item;
}
async function ensureDriverAssigned(driverId, routeId) {
    const current = (await getDriverState(driverId)) ?? {
        driverId,
        phase: "IDLE",
        version: 0,
    };
    // Already on the right route? keep it.
    if (current.routeId === routeId)
        return;
    // Assign / reassign to route and set baseline progress
    await ddb.send(new UpdateCommand({
        TableName: DRIVER_TABLE,
        Key: { driverId },
        UpdateExpression: "SET #routeId = :r, #phase = :ph, #currentStopIndex = if_not_exists(#currentStopIndex, :i0), #version = if_not_exists(#version, :v0) + :inc",
        ExpressionAttributeNames: {
            "#routeId": "routeId",
            "#phase": "phase",
            "#currentStopIndex": "currentStopIndex",
            "#version": "version",
        },
        ExpressionAttributeValues: {
            ":r": routeId,
            ":ph": "ENROUTE",
            ":i0": 0,
            ":v0": 0,
            ":inc": 1,
        },
    }));
}
// simple concurrency gate
async function mapLimit(arr, limit, fn) {
    const ret = [];
    let i = 0;
    const runners = Array(Math.min(limit, arr.length))
        .fill(0)
        .map(async () => {
        while (i < arr.length) {
            const idx = i++;
            try {
                ret[idx] = await fn(arr[idx]);
            }
            catch (e) {
                // capture error but continue
                console.error("Poller item failed:", e);
            }
        }
    });
    await Promise.all(runners);
    return ret;
}
// --- main handler ---
export const handler = async () => {
    // 1) fetch drivers and routes from simulator
    const [driversRaw, routesRaw] = await Promise.all([
        getJson("/drivers"),
        getJson("/routes"),
    ]);
    const drivers = driversRaw.map((d) => DriverDto.parse(d));
    const routes = routesRaw.map((r) => RouteDto.parse(r));
    // 2) upsert all routes
    await mapLimit(routes, CONC, upsertRoute);
    // 3) enrich with /routes/:driverId if available (optional deep info)
    //    do it only for drivers that appear assigned in /routes list or globally
    const driversNeedingDetail = new Set();
    for (const r of routes)
        if (r.driverId)
            driversNeedingDetail.add(r.driverId);
    // If your sim exposes per-driver route details, pull them and re-upsert
    await mapLimit(Array.from(driversNeedingDetail), CONC, async (driverId) => {
        try {
            const detail = await getJson(`/drives/${driverId}/routes`);
            const parsed = RouteDto.parse(detail);
            await upsertRoute(parsed);
        }
        catch (e) {
            // not fatal if endpoint doesn’t exist yet
            console.warn(`No detail for driver ${driverId}:`, e.message);
        }
    });
    // 4) ensure driver->route assignment in DriverState
    // Prefer route.driverId signals; if none, you could skip or apply custom matching logic
    await mapLimit(routes.filter((r) => r.driverId), CONC, async (r) => {
        if (r.driverId)
            await ensureDriverAssigned(r.driverId, r.id);
    });
    console.log(`Poller done: drivers=${drivers.length}, routes=${routes.length}, assigned=${routes.filter((r) => r.driverId).length}`);
};
