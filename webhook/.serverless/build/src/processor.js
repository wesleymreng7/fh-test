"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/processor.ts
var processor_exports = {};
__export(processor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(processor_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// src/aws-local.ts
function localAwsConfig() {
  const isLocal = process.env.IS_LOCAL === "true" || process.env.IS_OFFLINE === "true" || process.env.LOCALSTACK === "true" || process.env.STAGE === "local";
  const endpoint = process.env.AWS_ENDPOINT_URL || process.env.LOCALSTACK_URL || "http://localhost:4566";
  return isLocal ? {
    endpoint,
    region: process.env.AWS_REGION || "us-east-1",
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test" }
  } : {};
}

// src/libs/events.ts
var publishEvent = async () => {
};
var initializeEventPublisher = async () => {
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

// src/processor.ts
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient(localAwsConfig()));
var DRIVER_TABLE = process.env.DRIVER_STATE_TABLE;
var ARRIVE_RADIUS_M = parseInt(process.env.ARRIVE_RADIUS_M ?? "150", 10);
var DEPART_EXIT_RADIUS_M = parseInt(process.env.DEPART_EXIT_RADIUS_M ?? "200", 10);
var ARRIVE_MAX_SPEED_KPH = parseInt(process.env.ARRIVE_MAX_SPEED_KPH ?? "15", 10);
var DEPART_MIN_SPEED_KPH = parseInt(process.env.DEPART_MIN_SPEED_KPH ?? "8", 10);
var ARRIVE_DWELL_PINGS = parseInt(process.env.ARRIVE_DWELL_PINGS ?? "2", 10);
var DEPART_DWELL_PINGS = parseInt(process.env.DEPART_DWELL_PINGS ?? "2", 10);
var SIM_API = process.env.SIM_API_URL ?? "http://localhost:4001";
var getDriver = async (driverId) => (await ddb.send(new import_lib_dynamodb.GetCommand({ TableName: DRIVER_TABLE, Key: { driverId } })))?.Item;
var putDriver = (state) => ddb.send(new import_lib_dynamodb.PutCommand({ TableName: DRIVER_TABLE, Item: state }));
async function updateDriver(driverId, updates) {
  const names = { "#version": "version" };
  const values = { ":v0": 0, ":one": 1 };
  const sets = ["#version = if_not_exists(#version, :v0) + :one"];
  for (const [k, v] of Object.entries(updates)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.unshift(`#${k} = :${k}`);
  }
  await ddb.send(new import_lib_dynamodb.UpdateCommand({
    TableName: DRIVER_TABLE,
    Key: { driverId },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW"
  }));
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) return void 0;
  return res.json();
}
function toInternalRoute(r) {
  const stops = (r.stops ?? []).sort((a, b) => a.sequence - b.sequence).map((s) => ({
    id: s.id,
    type: s.type,
    lat: s.location.lat,
    lng: s.location.lng,
    radiusM: s.radiusM
  }));
  return { routeId: r.id, driverId: r.driverId, stops, status: r.status, updatedAt: r.updatedAt };
}
async function getRoute(routeId) {
  const main = await fetchJson(`${SIM_API}/routes/${routeId}`);
  const sim = main ?? await fetchJson(`${SIM_API}/routest/${routeId}`);
  return sim ? toInternalRoute(sim) : void 0;
}
async function getCurrentRouteForDriver(driverId) {
  const simDriver = await fetchJson(`${SIM_API}/drivers/${driverId}`);
  if (!simDriver) return void 0;
  const simRoutes = await fetchJson(`${SIM_API}/drivers/${driverId}/routes`);
  if (!simRoutes || simRoutes.length === 0) return void 0;
  const candidates = simRoutes.filter((r) => r.status === "EN_ROUTE" || r.status === "PLANNED");
  if (candidates.length === 0) return void 0;
  const pick = candidates.find((r) => r.status === "EN_ROUTE") ?? candidates.filter((r) => r.status === "PLANNED").sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))[0];
  return pick ? toInternalRoute(pick) : void 0;
}
function haversineMeters(a, b) {
  const toRad = (d) => d * Math.PI / 180;
  const R = 6371e3;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
var insideStopRadius = (stop, lat, lon) => haversineMeters({ lat, lon }, { lat: stop.lat, lon: stop.lng }) <= (stop.radiusM ?? ARRIVE_RADIUS_M);
async function handleGps(p) {
  await publishEvent("gps.received", { eventId: p.eventId, driverId: p.driverId }, "logistics.ingest");
  let state = await getDriver(p.driverId);
  if (!state) {
    state = { driverId: p.driverId, phase: "IDLE", insideCount: 0, outsideCount: 0, version: 0 };
    await putDriver(state);
  }
  await updateDriver(p.driverId, { lastLat: p.lat, lastLon: p.lng, lastUpdateAt: p.deviceTs });
  state = { ...state, lastLat: p.lat, lastLon: p.lng, lastUpdateAt: p.deviceTs, version: state.version + 1 };
  let route;
  if (state.routeId) {
    route = await getRoute(state.routeId);
  } else {
    const current = await getCurrentRouteForDriver(p.driverId);
    if (current) {
      await updateDriver(p.driverId, {
        routeId: current.routeId,
        currentStopIndex: 0,
        phase: "ENROUTE"
      });
      state = { ...state, routeId: current.routeId, currentStopIndex: 0, phase: "ENROUTE" };
      route = current;
    }
  }
  if (!route || !route.stops?.length || state.currentStopIndex === void 0) return;
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
      await publishEvent(
        stop.type === "PICKUP" ? "driver.arrived.pickup" : "driver.arrived.delivery",
        { eventId: p.eventId, driverId: p.driverId, routeId: state.routeId, stopId: stop.id, stopIndex: idx, lat: p.lat, lng: p.lng, occurredAt: p.deviceTs }
      );
    }
  } else {
    const departed = !isInside && speed >= DEPART_MIN_SPEED_KPH && nextOutside >= DEPART_DWELL_PINGS;
    if (departed) {
      const nextIdx = idx + 1;
      const completed = nextIdx >= route.stops.length;
      await updateDriver(p.driverId, {
        phase: completed ? "COMPLETED" : "ENROUTE",
        departedAt: p.deviceTs,
        currentStopIndex: completed ? idx : nextIdx,
        insideCount: 0
      });
      state = {
        ...state,
        phase: completed ? "COMPLETED" : "ENROUTE",
        departedAt: p.deviceTs,
        currentStopIndex: completed ? idx : nextIdx,
        insideCount: 0,
        version: state.version + 1
      };
      await publishEvent("driver.departed.stop", {
        eventId: p.eventId,
        driverId: p.driverId,
        routeId: state.routeId,
        stopId: stop.id,
        stopIndex: idx,
        occurredAt: p.deviceTs
      });
    }
  }
}
var handler = async (event) => {
  for (const rec of event.Records) {
    try {
      const msg = JSON.parse(rec.body);
      if (msg.type === "gps") await handleGps(msg.payload);
      else console.warn("Ignoring non-gps message:", msg.type);
    } catch (err) {
      console.error("Record failed", err);
      throw err;
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=processor.js.map
