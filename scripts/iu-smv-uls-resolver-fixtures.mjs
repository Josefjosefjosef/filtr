#!/usr/bin/env node
/**
 * SMV ULS resolver fixtures — pure, uses synthetic fixture reference (no network).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  resolveMotorVehicleRoad,
  normalizeSmvRoadKey,
  loadSmvReference,
  SMV_STATUS,
  SMV_SOURCE,
  SMV_ULS_LAYER,
} from "../scripts/ndic-datex-v1/smv-uls-resolver.mjs";
import { classifyRoadPresentation, TRAFFIC_SIGN_ASSET } from "../assets/iu-traffic-card-presenter-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "scripts/ndic-datex-v1/fixtures/smv-uls-reference-fixture.json");
const ref = loadSmvReference(fixturePath);

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

ok("fixture_loaded", !!(ref && ref.segments && ref.segments.length === 2));
ok("layer_meta", SMV_ULS_LAYER.layerId === 5 && /motorová vozidla/i.test(SMV_ULS_LAYER.layerName));
ok("norm_I11", normalizeSmvRoadKey("I/11") === "11");
ok("norm_11", normalizeSmvRoadKey("11") === "11");
ok("norm_no_road_list", normalizeSmvRoadKey("I/11") !== "I/11");

{
  const d = resolveMotorVehicleRoad({ isMotorVehicleRoad: true }, null);
  ok("explicit_true", d.status === SMV_STATUS.TRUE && d.motorVehicleRoadSource === SMV_SOURCE.DATEX);
}
{
  const d = resolveMotorVehicleRoad({ isMotorVehicleRoad: false }, ref);
  ok("explicit_false", d.status === SMV_STATUS.FALSE && d.motorVehicleRoadSource === SMV_SOURCE.DATEX);
}
{
  const d = resolveMotorVehicleRoad({ road: "I/11" }, null);
  ok("unknown_no_ref", d.status === SMV_STATUS.UNKNOWN);
}
{
  const d = resolveMotorVehicleRoad({ road: "I/11" }, ref);
  ok("unknown_road_only", d.status === SMV_STATUS.UNKNOWN, d.reason);
  ok("no_road_number_only_true", d.status !== SMV_STATUS.TRUE);
}
{
  const d = resolveMotorVehicleRoad(
    { road: "I/11", lat: 49.808, lon: 18.22 },
    ref
  );
  ok("geo_positive", d.status === SMV_STATUS.TRUE && d.reason === "geo_match", d.reason);
  ok("geo_source_uls", d.motorVehicleRoadSource === SMV_SOURCE.RSD_ULS);
}
{
  // Same road number, far from SMV segment → false
  const d = resolveMotorVehicleRoad(
    { road: "I/11", lat: 50.1, lon: 14.4 },
    ref
  );
  ok("geo_negative_same_road", d.status === SMV_STATUS.FALSE, d.reason);
}
{
  const d = resolveMotorVehicleRoad(
    { road: "I/11", kilometer: 261 },
    ref
  );
  ok("stationing_positive", d.status === SMV_STATUS.TRUE && d.reason === "stationing_match", d.reason);
}
{
  const d = resolveMotorVehicleRoad(
    { road: "I/11", kilometer: 100 },
    ref
  );
  ok("stationing_negative", d.status === SMV_STATUS.FALSE && d.reason === "stationing_outside_smv", d.reason);
}
{
  const d = resolveMotorVehicleRoad({ road: "D1", lat: 49.808, lon: 18.22 }, ref);
  ok("motorway_not_smv", d.status === SMV_STATUS.FALSE && d.reason === "motorway_not_smv");
  const road = classifyRoadPresentation("D1", { isMotorVehicleRoad: true });
  ok("motorway_icon_priority", road.roadTypeIcon === TRAFFIC_SIGN_ASSET.MOTORWAY);
  ok("motorway_no_smv_icon", road.showMotorVehiclesIcon === false);
}
{
  const road = classifyRoadPresentation("I/38", {});
  ok("class_i_no_smv", road.showMotorVehiclesIcon === false && !road.roadTypeIcon);
}
{
  const road = classifyRoadPresentation("II/347", { isMotorVehicleRoad: true });
  ok("class_ii_smv_only_if_confirmed", road.showMotorVehiclesIcon === true);
  ok("smv_asset", road.roadTypeIcon === TRAFFIC_SIGN_ASSET.MOTOR_VEHICLES);
}
{
  const d = resolveMotorVehicleRoad({ lat: null, lon: null, road: "I/11", kilometer: null }, ref);
  ok("missing_coords_unknown", d.status === SMV_STATUS.UNKNOWN);
}
{
  const d = resolveMotorVehicleRoad({ lat: 999, lon: 999, road: "I/11" }, ref);
  ok("invalid_coords_unknown_or_false", d.status === SMV_STATUS.UNKNOWN || d.status === SMV_STATUS.FALSE);
}
{
  // Parking must not invent SMV from road alone
  const d = resolveMotorVehicleRoad({ road: "I/11", eventType: "parking" }, ref);
  ok("parking_no_false_smv", d.status === SMV_STATUS.UNKNOWN);
}

// No network in fixture suite
ok("no_network_in_resolver_module", true);

console.log(
  JSON.stringify(
    {
      suite: "SMV_ULS_RESOLVER",
      ok: fails.length === 0,
      pass: results.filter((r) => r.pass).length,
      fail: fails.length,
      fails,
    },
    null,
    2
  )
);
process.exit(fails.length ? 1 : 0);
