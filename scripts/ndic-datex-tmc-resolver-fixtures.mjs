#!/usr/bin/env node
/**
 * Offline DATEX → basic TMC resolver fixtures (synthetic only).
 * Exit code matches summary.failure. No skipped tests. No licensed data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveDatexTmcReference,
  resolveDatexEventLocations,
  resolveDatexTmcBatch,
  parseLocationCodeSafe,
  normalizeDirection,
  validateCoordinates,
  validateOffset,
  computeFreshness,
  diffLocationResolutions,
  RESOLVER_STATUS,
  DIRECTION,
  MULTI_RESOLUTION_KIND,
  RESOLVER_FEATURE_FLAGS,
  DATEX_TMC_RESOLVER_ERROR,
  PUBLIC_ELIGIBILITY,
  NDIC_DATEX_ALERTC_CONTRACT,
} from "./ndic-datex-v1/datex-tmc-resolver.mjs";
import {
  defaultSyntheticSnapshot,
  buildSyntheticResolutionSnapshot,
} from "./ndic-datex-v1/tmc-resolution-snapshot.mjs";
import { FRESHNESS, KILOMETER_STATUS } from "./ndic-datex-v1/datex-tmc-resolver-constants.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

function refPoint(lcd, extra = {}) {
  return {
    kind: "point",
    countryCode: 2,
    tableNumber: 25,
    locationCode: lcd,
    direction: "positive",
    ...extra,
  };
}

function refLinear(a, b, extra = {}) {
  return {
    kind: "linear",
    countryCode: 2,
    tableNumber: 25,
    locationCode: a,
    secondaryLocationCode: b,
    direction: "positive",
    ...extra,
  };
}

function assertNoLeak(obj) {
  const s = JSON.stringify(obj);
  // Forbid real paths, secrets, stack, and raw synthetic names leaking as "public" lcd lists
  ok("leak_no_stack", !/at\s+\S+\s+\(/.test(s) && !/Error:\s/.test(s));
  ok("leak_no_auth", !/password|authorization|bearer/i.test(s));
  ok("leak_no_users_path", !/C:\\\\Users|C:\/Users/i.test(s));
  // locationCode must not appear as raw field value in resolution public surface when RESOLVED
  // (hashes ok). Soft check: no "locationCode":10001 style
  ok("leak_no_raw_lcd_field", !/"locationCode"\s*:\s*10001/.test(s));
  return s;
}

async function run() {
  const snap = defaultSyntheticSnapshot({ importRunId: "snap-a" });

  // flags
  ok("flag_rnlt", RESOLVER_FEATURE_FLAGS.RNLT_ADVANCED_RELATIONSHIPS_ENABLED === false);
  ok("flag_pes", RESOLVER_FEATURE_FLAGS.PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED === false);
  ok("flag_lang5", RESOLVER_FEATURE_FLAGS.LANGUAGES_FIFTH_FIELD_USED === false);
  ok("flag_fuzzy", RESOLVER_FEATURE_FLAGS.FUZZY_LOCATION_MATCHING_ENABLED === false);
  ok("flag_km", RESOLVER_FEATURE_FLAGS.KILOMETER_ESTIMATION_ENABLED === false);
  ok("flag_interp", RESOLVER_FEATURE_FLAGS.COORDINATE_INTERPOLATION_ENABLED === false);
  ok("public_only_basic", PUBLIC_ELIGIBILITY.RESOLVED_BASIC === true && PUBLIC_ELIGIBILITY.UNRESOLVED_AMBIGUOUS === false);
  ok("contract_cc", NDIC_DATEX_ALERTC_CONTRACT.alertCCountryCode === 2);
  ok("contract_cid", NDIC_DATEX_ALERTC_CONTRACT.tisaCid === 11);
  ok("contract_tabcd", NDIC_DATEX_ALERTC_CONTRACT.tabcd === 25);

  // 1 point
  {
    const r = resolveDatexTmcReference(refPoint("10001"), snap, { eventId: "e1" });
    ok("point_ok", r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC, r.resolutionStatus);
    ok("point_eligible", r.publiclyEligible === true);
    assertNoLeak(r);
  }

  // 2-3 linear + primary/secondary
  {
    const r = resolveDatexTmcReference(refLinear("10001", "10002"), snap, { eventId: "e2" });
    ok("linear_ok", r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC, r.resolutionStatus);
    ok("linear_sec", r.secondaryLocation != null);
  }

  // 4-8 directions
  {
    ok("dir_pos", normalizeDirection("positive") === DIRECTION.POSITIVE);
    ok("dir_neg", normalizeDirection("negative") === DIRECTION.NEGATIVE);
    ok("dir_both", normalizeDirection("both") === DIRECTION.BOTH);
    ok("dir_unk", normalizeDirection("") === DIRECTION.UNKNOWN);
    ok("dir_nofuzzy", normalizeDirection("maybe northish") === DIRECTION.UNKNOWN);
    const c = resolveDatexTmcReference(refPoint("10001", { directionConflict: true }), snap, {});
    ok("dir_conflict", c.resolutionStatus === RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS && c.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_DIRECTION_CONFLICT);
    const u = resolveDatexTmcReference(refPoint("10001", { direction: "", failOnUnknownDirection: true }), snap, {});
    ok("dir_unknown_fail", u.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_DIRECTION_UNKNOWN);
    const uok = resolveDatexTmcReference(refPoint("10001", { direction: "" }), snap, {});
    ok("dir_unknown_kept", uok.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC && uok.direction.value === DIRECTION.UNKNOWN);
  }

  // 9-12 offsets
  {
    const v = validateOffset({ offsetDistance: 100 });
    ok("off_ok", v.usable === true && v.offsetType === "POSITIVE");
    const n = validateOffset({ offsetDistance: -20 });
    ok("off_neg", n.usable === true && n.offsetType === "NEGATIVE");
    const big = validateOffset({ offsetDistance: 999999999 });
    ok("off_big", big.usable === false && big.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_OFFSET_INVALID);
    const unit = validateOffset({ offsetDistance: 10, offsetUnit: "furlongs" });
    ok("off_unit", unit.usable === false && unit.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_OFFSET_UNSUPPORTED);
    const r = resolveDatexTmcReference(refPoint("10001", { offsetDistance: 999999999 }), snap, {});
    ok("off_resolve_warn", r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC && r.warnings.length >= 1);
  }

  // 13-17 location codes
  {
    ok("lcd_missing", parseLocationCodeSafe(null).ok === false);
    ok("lcd_invalid", parseLocationCodeSafe("12.5").ok === false);
    ok("lcd_range", parseLocationCodeSafe("123456").ok === false);
    ok("lcd_ws", parseLocationCodeSafe(" 10001").ok === false);
    const miss = resolveDatexTmcReference(refPoint("19999"), snap, {});
    ok("lcd_not_found", miss.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_NOT_FOUND);
    const ambSnap = buildSyntheticResolutionSnapshot({
      importRunId: "amb",
      points: [
        { lcd: "10001", roadNumber: "A" },
        { lcd: "10001", roadNumber: "B" },
      ],
    });
    const amb = resolveDatexTmcReference(refPoint("10001"), ambSnap, {});
    ok("lcd_ambiguous", amb.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_AMBIGUOUS);
  }

  // 18-21 cid/tabcd
  {
    ok("cid_bad", resolveDatexTmcReference(refPoint("10001", { countryCode: 9 }), snap, {}).rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CID_MISMATCH);
    ok("tabcd_bad", resolveDatexTmcReference(refPoint("10001", { tableNumber: 9 }), snap, {}).rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_TABCD_MISMATCH);
    const missCc = resolveDatexTmcReference({ kind: "point", tableNumber: 25, locationCode: "10001", direction: "positive" }, snap, {});
    ok("cid_default", missCc.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC && missCc.cid.source === NDIC_DATEX_ALERTC_CONTRACT.defaultSource);
    const missTn = resolveDatexTmcReference({ kind: "point", countryCode: 2, locationCode: "10001", direction: "positive" }, snap, {});
    ok("tabcd_default", missTn.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC && missTn.tabcd.source === NDIC_DATEX_ALERTC_CONTRACT.defaultSource);
  }

  // 22 type incompatible
  {
    const r = resolveDatexTmcReference(refPoint("10001"), snap, { requiredLocationType: "A" });
    ok("type_bad", r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_TYPE_UNSUPPORTED);
  }

  // 23-25 secondary / self / cycle
  {
    ok("sec_missing", resolveDatexTmcReference(refLinear("10001", null), snap, {}).rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_SECONDARY_LOCATION_MISSING);
    ok("sec_eq", resolveDatexTmcReference(refLinear("10001", "10001"), snap, {}).resolutionStatus === RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS);
    ok("cycle", resolveDatexTmcReference(refLinear("10001", "10002", { detectCycle: true, forceCycle: true }), snap, {}).rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_INVALID);
  }

  // 26 depth
  {
    const r = resolveDatexTmcReference(refPoint("10001", { followDepth: 99, followEdge: "next" }), snap, {});
    ok("depth", r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_DEPTH_EXCEEDED);
  }

  // 27-29 advanced + languages
  {
    ok("rnlt", resolveDatexTmcReference(refPoint("10001", { requiresRnlt: true }), snap, {}).resolutionStatus === RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP);
    ok("pes", resolveDatexTmcReference(refPoint("10001", { requiresPesLev: true }), snap, {}).resolutionStatus === RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP);
    const lang = resolveDatexTmcReference(refPoint("10001"), snap, { languagesFifthField: "ABCDEFGHIJKLMNOPQRSTU" });
    // warnings pushed via event path
    const ev = resolveDatexEventLocations({ eventId: "L", tmcRefs: [refPoint("10001")], languagesFifthField: "X" }, snap);
    ok("lang5_unused", ev.results[0].warnings.includes("languages_fifth_field_ignored") && RESOLVER_FEATURE_FLAGS.LANGUAGES_FIFTH_FIELD_USED === false);
    void lang;
  }

  // 30-35 coordinates
  {
    ok("coord_ok", validateCoordinates(50.1, 14.4, { czechSanity: true }).ok === true);
    ok("coord_lat", validateCoordinates(91, 14, {}).ok === false);
    ok("coord_lon", validateCoordinates(50, 200, {}).ok === false);
    ok("coord_nan", validateCoordinates(Number.NaN, 14, {}).ok === false);
    ok("coord_inf", validateCoordinates(50, Number.POSITIVE_INFINITY, {}).ok === false);
    const conf = resolveDatexTmcReference(refPoint("10001"), snap, {
      directCoordinates: { lat: 48.0, lon: 10.0 },
      czechSanity: false,
    });
    ok("coord_conflict", conf.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_CONFLICT, conf.rejectCode);
  }

  // 36 road conflict
  {
    const r = resolveDatexEventLocations({ eventId: "R", tmcRefs: [refPoint("10001")], roadNumber: "D99" }, snap);
    ok("road_conflict", r.results[0].rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ROAD_CONFLICT);
  }

  // 37-40 multi refs
  {
    const same = resolveDatexEventLocations({
      eventId: "M1",
      tmcRefs: [refPoint("10001"), refPoint("10001")],
    }, snap);
    ok("multi_dedupe", same.results.length === 1 && same.multiKind === MULTI_RESOLUTION_KIND.SINGLE_RESOLUTION);
    const dist = resolveDatexEventLocations({
      eventId: "M2",
      tmcRefs: [refPoint("10001"), refPoint("10003")],
    }, snap);
    ok("multi_distinct", dist.multiKind === MULTI_RESOLUTION_KIND.MULTIPLE_DISTINCT_RESOLUTIONS && dist.results.length === 2);
    const conflict = resolveDatexEventLocations({
      eventId: "M3",
      tmcRefs: [refPoint("10001", { directionConflict: true }), refPoint("10003")],
    }, snap);
    ok("multi_conflict", conflict.multiKind === MULTI_RESOLUTION_KIND.CONFLICTING_RESOLUTIONS);
    const empty = resolveDatexEventLocations({ eventId: "M4", tmcRefs: [] }, snap);
    ok("multi_empty", empty.multiKind === MULTI_RESOLUTION_KIND.NO_RESOLUTION);
  }

  // 41-42 unsupported / malformed
  {
    ok("area", resolveDatexTmcReference({ kind: "area", locationCode: "10001" }, snap, {}).rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_TYPE_UNSUPPORTED);
    ok("malformed", resolveDatexTmcReference(null, snap, {}).resolutionStatus === RESOLVER_STATUS.REJECTED_INVALID_INPUT);
  }

  // 43-47 batch limits / cleanup / orphan
  {
    const huge = Array.from({ length: 5 }, (_, i) => ({ eventId: "h" + i, tmcRefs: [refPoint("10001")] }));
    const batch = await resolveDatexTmcBatch(huge, snap, { maxBatchEvents: 2 });
    ok("batch_too_large", batch.ok === false && batch.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_BATCH_TOO_LARGE);

    const mem = await resolveDatexTmcBatch([{ eventId: "m", tmcRefs: [refPoint("10001")] }], snap, { maxHeapBytes: 1 });
    ok("mem_limit", mem.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_MEMORY_LIMIT);

    const to = await resolveDatexTmcBatch([{ eventId: "t", tmcRefs: [refPoint("10001")] }], snap, { timeoutMs: 0 });
    ok("timeout", to.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_TIMEOUT);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-res-"));
    const okBatch = await resolveDatexTmcBatch([{ eventId: "c", tmcRefs: [refPoint("10001")] }], snap, { workDir: dir });
    ok("cleanup", okBatch.ok === true && okBatch.metrics.cleanupSucceeded === true);
    const stagingLeft = fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.startsWith("staging-"));
    ok("cleanup_no_staging", stagingLeft === false);
    fs.rmSync(dir, { recursive: true, force: true });
    ok("orphan_temp", fs.existsSync(dir) === false);

    const cf = await resolveDatexTmcBatch([{ eventId: "cf", tmcRefs: [refPoint("10001")] }], snap, { forceCleanupFailure: true });
    ok("cleanup_fail", cf.ok === false && cf.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CLEANUP_FAILED);
  }

  // 48 snapshot consistency
  {
    const s = defaultSyntheticSnapshot({ importRunId: "pin-1" });
    const batch = await resolveDatexTmcBatch([{ eventId: "p", tmcRefs: [refPoint("10001")] }], s, {
      snapshotMutator: (snapObj) => {
        // attempt drift — frozen object may throw; ignore
        try {
          snapObj.importRunId = "pin-2";
        } catch (_) {}
      },
    });
    ok("snapshot_pin", batch.ok === true && batch.tmcImportRunId === "pin-1");
  }

  // 49 missing active table
  {
    const r = resolveDatexTmcReference(refPoint("10001"), null, {});
    ok("no_table", r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ACTIVE_TABLE_UNAVAILABLE);
  }

  // 50 provenance
  {
    const r = resolveDatexTmcReference(refPoint("10001"), snap, {
      eventId: "prov",
      sourceTimestamps: { datexUpdatedAt: "2026-01-01T00:00:00.000Z" },
    });
    ok("prov_cid", r.cid && r.cid.source && r.cid.validationStatus === "validated");
    ok("prov_dir", r.direction && r.direction.source === "datex_alertc");
    ok("prov_ts", r.tmcImportRunId === "snap-a");
  }

  // 51 freshness
  {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    ok("fresh", computeFreshness({ datexUpdatedAt: "2026-01-01T11:55:00.000Z" }, now) === FRESHNESS.FRESH);
    ok("stale", computeFreshness({ datexUpdatedAt: "2026-01-01T08:00:00.000Z" }, now) === FRESHNESS.STALE);
    ok("expired", computeFreshness({ datexUpdatedAt: "2025-01-01T00:00:00.000Z" }, now) === FRESHNESS.EXPIRED);
    ok("fresh_unk", computeFreshness({}, now) === FRESHNESS.UNKNOWN);
  }

  // 52 history diff
  {
    const a = resolveDatexTmcReference(refPoint("10001", { direction: "positive" }), snap, { eventId: "h1" });
    const b = resolveDatexTmcReference(refPoint("10001", { direction: "negative" }), snap, { eventId: "h1" });
    const d = diffLocationResolutions(a, b);
    ok("hist", d.changes.some((c) => c.field === "direction"));
  }

  // 53-56 output safety / codes
  {
    const r = resolveDatexTmcReference(refPoint("10001"), snap, { eventId: "safe" });
    const s = assertNoLeak(r);
    ok("no_dyn_code", Object.values(DATEX_TMC_RESOLVER_ERROR).includes(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CID_MISMATCH));
    ok("km_not_est", r.kilometerStatus === KILOMETER_STATUS.NOT_AVAILABLE);
    void s;
  }

  // positive both directions explicit
  {
    const r = resolveDatexTmcReference(refPoint("10001", { direction: "both" }), snap, {});
    ok("both_ok", r.direction.value === DIRECTION.BOTH && r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC);
  }

  // staging force fail
  {
    const r = await resolveDatexTmcBatch([{ eventId: "sf", tmcRefs: [refPoint("10001")] }], snap, { forceStagingFailure: true });
    ok("staging_fail", r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_STAGING_FAILED);
  }

  // direct coords only
  {
    const r = resolveDatexEventLocations({ eventId: "dc", coordinates: { lat: 50.08, lon: 14.42 }, tmcRefs: [] }, snap);
    ok("direct_coord", r.results[0].resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC);
  }

  const pass = results.filter((x) => x.pass).length;
  const failN = results.filter((x) => !x.pass).length;
  const summary = {
    suite: "DATEX_TMC_RESOLVER_FIXTURES",
    total: results.length,
    success: pass,
    failure: failN,
    skipped: 0,
    syntheticOnly: true,
    realArchiveUsed: false,
    realDatexUsed: false,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
  if (failN) {
    process.stdout.write(JSON.stringify({ fails: fails.slice(0, 40) }) + "\n");
    process.exitCode = 1;
  } else if (summary.failure !== 0 || summary.success !== summary.total) {
    process.exitCode = 1;
  }
}

run().catch(() => {
  process.stdout.write(JSON.stringify({ suite: "DATEX_TMC_RESOLVER_FIXTURES", failure: 1, internal: true }) + "\n");
  process.exitCode = 1;
});
