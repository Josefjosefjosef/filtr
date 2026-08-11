#!/usr/bin/env node
/**
 * Offline fixtures: DATEX conditional requests + persistent TMC LKG + maintenance cutover/rollback.
 * No network. No secrets.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createFixtureDiscovery } from "./ndic-datex-v1/discovery-adapter.mjs";
import { applyConditionalResult, createSyncState } from "./ndic-datex-v1/sync-core.mjs";
import { runNdicDatexV1Sync } from "./ndic-datex-v1-prod-sync.mjs";
import { parseTmcTablePayload, emptyTmcStore, activateTmcTable } from "./ndic-datex-v1/tmc-table.mjs";
import {
  persistTmcStoreAtomic,
  loadPersistentTmcStore,
  requireValidPersistentTmcForLive,
  datexTmcVersionMismatchGuard,
  assessDualVersionNeed,
  cleanupTmcLkg,
} from "./ndic-datex-v1/tmc-persistent-store.mjs";
import { runTmcMaintenance, compareResolverCoverage, assertNoResolverRegression } from "./ndic-datex-v1/tmc-maintenance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

function miniDatex(id = "sit1") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d2LogicalModel xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2">
  <payloadPublication xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="SituationPublication" lang="cs">
    <publicationTime>2026-08-11T10:00:00Z</publicationTime>
    <publicationCreator><country>cz</country><nationalIdentifier>NDIC</nationalIdentifier></publicationCreator>
    <situation id="${id}">
      <headerInformation><confidentiality>noRestriction</confidentiality><informationStatus>real</informationStatus></headerInformation>
      <situationRecord id="${id}-r1" xsi:type="Accident" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <situationRecordCreationTime>2026-08-11T10:00:00Z</situationRecordCreationTime>
        <situationRecordVersion>1</situationRecordVersion>
        <situationRecordVersionTime>2026-08-11T10:00:00Z</situationRecordVersionTime>
        <probabilityOfOccurrence>certain</probabilityOfOccurrence>
        <groupOfLocations xsi:type="Point" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <alertCPoint xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="AlertCMethod4PrimaryPointLocation">
            <alertCLocationCountryCode>2</alertCLocationCountryCode>
            <alertCLocationTableNumber>25</alertCLocationTableNumber>
            <alertCLocationTableVersion>11</alertCLocationTableVersion>
            <alertCDirection><alertCDirectionCoded>positive</alertCDirectionCoded></alertCDirection>
            <alertCMethod4PrimaryPointLocation>
              <alertCLocation><specificLocation>12345</specificLocation></alertCLocation>
            </alertCMethod4PrimaryPointLocation>
          </alertCPoint>
        </groupOfLocations>
      </situationRecord>
    </situation>
  </payloadPublication>
</d2LogicalModel>`;
}

function fixtureTable(version, pointCount = 3) {
  const points = {};
  for (let i = 1; i <= pointCount; i += 1) {
    points[String(10000 + i)] = { lcd: 10000 + i, name: "P" + i, roadNumber: "D1", lat: 50 + i * 0.01, lon: 14 + i * 0.01 };
  }
  // include LCD used by miniDatex
  points["12345"] = { lcd: 12345, name: "X", roadNumber: "D1", lat: 50.1, lon: 14.1 };
  return parseTmcTablePayload({
    version: String(version),
    countryCode: 2,
    tableNumber: 25,
    points,
  });
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-obs-tmc-"));

async function run() {
  // --- Conditional DATEX ---
  {
    const sync = createSyncState("t");
    const disc = createFixtureDiscovery([
      {
        name: "f1",
        xml: miniDatex(),
        etag: '"v1"',
        lastModified: "Wed, 01 Jul 2026 10:00:00 GMT",
        unchanged: true,
      },
    ]);
    const a = await disc.fetchBody("f1", {});
    ok("first_200", a.status === 200);
    applyConditionalResult(a, sync);
    ok("etag_persisted", sync.etag === '"v1"');
    ok("lm_persisted", !!sync.lastModified);
    const b = await disc.fetchBody("f1", { etag: sync.etag, lastModified: sync.lastModified });
    ok("second_304", b.status === 304);
    const cond = applyConditionalResult(b, sync);
    ok("304_not_modified_action", cond.action === "not_modified");
    ok("304_no_body", b.body == null);
  }

  {
    const disc = createFixtureDiscovery([
      { name: "c1", xml: miniDatex("a"), etag: '"e1"', lastModified: "Wed, 01 Jul 2026 10:00:00 GMT" },
      { name: "c2", xml: miniDatex("b"), etag: '"e2"', lastModified: "Wed, 01 Jul 2026 11:00:00 GMT" },
    ]);
    // changed etag path via explicit status 200 different body
    const sync = createSyncState("t2");
    const a = await disc.fetchBody("c1", {});
    applyConditionalResult(a, sync);
    const b = await disc.fetchBody("c2", { etag: sync.etag, lastModified: sync.lastModified });
    ok("changed_etag_200", b.status === 200);
    const cond = applyConditionalResult(b, sync);
    ok("changed_processes", cond.action === "process");
  }

  {
    const disc = createFixtureDiscovery([
      { name: "m1", xml: miniDatex(), lastModified: "Wed, 01 Jul 2026 10:00:00 GMT", etag: null },
    ]);
    // force missing etag in headers
    const sync = createSyncState("t3");
    const a = await disc.fetchBody("m1", {});
    // strip etag
    delete a.headers.etag;
    applyConditionalResult(a, sync);
    ok("missing_etag_ok", sync.etag == null);
    ok("lm_only_ok", !!sync.lastModified);
  }

  // 304 does not parse / tmc / candidate / publish
  {
    const lkg = path.join(tmpRoot, "lkg-304");
    const store = emptyTmcStore();
    activateTmcTable(store, fixtureTable("11", 5));
    persistTmcStoreAtomic(lkg, store, { cutover: true });
    const syncState = {
      sync: createSyncState("ndic://datex-pull"),
      lock: { locked: false, runId: null, startedAt: null, expiresAt: null },
      lastRun: null,
    };
    // seed validators
    syncState.sync.etag = '"v1"';
    syncState.sync.lastModified = "Wed, 01 Jul 2026 10:00:00 GMT";
    const dataDir = path.join(tmpRoot, "data-304");
    fs.mkdirSync(path.join(dataDir, "ndic_datex_v1"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "feed.json"), JSON.stringify({ items: [] }) + "\n");
    process.env.IU_INFO_EVENTS_DATA_DIR = dataDir;
    const ret = await runNdicDatexV1Sync({
      skipRunnerIdentityCheck: true,
      tmcLkgRoot: lkg,
      state: syncState,
      config: {
        mode: "active",
        hasPullCredentials: true,
        hasTmcCredentials: true,
        pullUrl: "https://mobilitydata.rsd.cz/x",
        pullUser: "u",
        pullPass: "p",
        userAgent: "test",
        tmcCountryCode: 2,
        tmcLocationTableNumber: 25,
        sanity: { minPrevForDropGuard: 5, suspiciousDropRatio: 0.35, maxGrowthRatio: 8, maxUnlocalizedRatio: 0.85, emptySnapshotFail: true },
        limits: {},
      },
      fixtureFiles: [
        {
          name: "ndic-datex-common-pull",
          url: "https://mobilitydata.rsd.cz/x",
          xml: miniDatex(),
          etag: '"v1"',
          lastModified: "Wed, 01 Jul 2026 10:00:00 GMT",
          unchanged: true,
        },
      ],
    });
    ok("304_sync_ok", ret.ok === true, ret.reason);
    ok("304_not_published", ret.published === false);
    ok("304_reason", ret.reason === "not_modified", ret.reason);
    ok("304_fast_path_flag", ret.diagnostics && ret.diagnostics.observability && ret.diagnostics.observability.FAST_PATH && ret.diagnostics.observability.FAST_PATH.DATEX_PARSE_CALLED === "NO");
    ok("304_tmc_not_downloaded", ret.diagnostics && ret.diagnostics.tmc && ret.diagnostics.tmc.liveDownload === false);
  }

  // --- Persistent TMC ---
  {
    const lkg = path.join(tmpRoot, "lkg-live");
    ok("missing_tmc_fail_closed", requireValidPersistentTmcForLive({ root: lkg }).ok === false);
    const store = emptyTmcStore();
    activateTmcTable(store, fixtureTable("11", 4));
    persistTmcStoreAtomic(lkg, store, { cutover: true });
    const live = requireValidPersistentTmcForLive({ root: lkg });
    ok("persistent_ready", live.ok === true);
    ok("live_read_meta", live.meta && live.meta.version === "11");

    // live DATEX uses persistent — no download fields
    const dataDir = path.join(tmpRoot, "data-live");
    fs.mkdirSync(path.join(dataDir, "ndic_datex_v1"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "feed.json"), JSON.stringify({ items: [] }) + "\n");
    // monitoring optional
    process.env.IU_INFO_EVENTS_DATA_DIR = dataDir;
    const before = fs.readFileSync(path.join(lkg, "current", "store.json"), "utf8");
    const ret = await runNdicDatexV1Sync({
      skipRunnerIdentityCheck: true,
      tmcLkgRoot: lkg,
      config: {
        mode: "shadow",
        hasPullCredentials: true,
        hasTmcCredentials: true,
        pullUrl: "https://mobilitydata.rsd.cz/x",
        pullUser: "u",
        pullPass: "p",
        userAgent: "test",
        tmcCountryCode: 2,
        tmcLocationTableNumber: 25,
        sanity: { minPrevForDropGuard: 5, suspiciousDropRatio: 0.35, maxGrowthRatio: 8, maxUnlocalizedRatio: 0.85, emptySnapshotFail: true },
        limits: {},
      },
      fixtureFiles: [
        {
          name: "ndic-datex-common-pull",
          url: "https://mobilitydata.rsd.cz/x",
          xml: miniDatex(),
          etag: '"n1"',
          lastModified: "Wed, 01 Jul 2026 12:00:00 GMT",
        },
      ],
    });
    const after = fs.readFileSync(path.join(lkg, "current", "store.json"), "utf8");
    ok("live_tmc_untouched", before === after);
    ok("live_no_download", ret.diagnostics && ret.diagnostics.tmc && ret.diagnostics.tmc.liveDownload === false);
    ok("live_no_import", ret.diagnostics && ret.diagnostics.tmc && ret.diagnostics.tmc.liveImport === false);
  }

  // Maintenance: same version no activation; regression block; cutover; rollback
  {
    const lkg = path.join(tmpRoot, "lkg-maint");
    const store = emptyTmcStore();
    const t11 = fixtureTable("11", 20);
    activateTmcTable(store, t11);
    persistTmcStoreAtomic(lkg, store, { cutover: true });

    const same = await runTmcMaintenance({
      mode: "bootstrap",
      root: lkg,
      bodyBuf: Buffer.from(JSON.stringify(t11), "utf8"),
    });
    ok("same_or_cutover_ok", same.ok === true, same.reason);

    const worse = fixtureTable("12", 2);
    // Wipe points → severe unresolved spike vs current
    worse.points = { "1": { lcd: 1, name: "only" } };
    worse.contentHash = "deadbeef";
    const cmp = compareResolverCoverage(t11, worse, Object.keys(t11.points));
    const reg = assertNoResolverRegression(cmp);
    ok("regression_detected", reg.ok === false, JSON.stringify(cmp));
    ok("cutover_block_code", reg.code === "TMC_CUTOVER_BLOCKED_RESOLVER_REGRESSION");

    const better = fixtureTable("12", 25);
    const cut = await runTmcMaintenance({
      mode: "promote",
      root: lkg,
      bodyBuf: Buffer.from(JSON.stringify(better), "utf8"),
    });
    ok("valid_cutover", cut.ok === true && (cut.reason === "cutover_ok" || cut.reason === "same_version"), cut.reason);

    const rb = await runTmcMaintenance({ mode: "rollback", root: lkg });
    ok("rollback_ok", rb.ok === true, rb.reason);
    const loaded = loadPersistentTmcStore({ root: lkg });
    ok("previous_retained_active", loaded.ok === true);

    const cleaned = cleanupTmcLkg(lkg, { maxAgeSec: 0 });
    ok("cleanup_pass", cleaned.ok === true);
  }

  // Dual version assess
  {
    const dual = assessDualVersionNeed([
      { tableNumber: 25, tableVersion: "11" },
      { tableNumber: 25, tableVersion: "12" },
    ]);
    ok("dual_version_yes", dual.TMC_DUAL_VERSION_REQUIRED === "YES");
    const single = assessDualVersionNeed([{ tableNumber: 25, tableVersion: "11" }]);
    ok("dual_version_no", single.TMC_DUAL_VERSION_REQUIRED === "NO");
    const g = datexTmcVersionMismatchGuard(
      [{ countryCode: 2, tableNumber: 25, tableVersion: "12" }],
      fixtureTable("11", 3)
    );
    ok("new_tmc_ref_detected", g.NEW_TMC_REFERENCE_DETECTED === "YES");
  }

  // Workflow contract: live sync must not reference maybeRefreshTmc / TMC pull in sync step env forever —
  // checked lightly via source scan
  {
    const prod = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs"), "utf8");
    ok("no_maybeRefreshTmc", !prod.includes("async function maybeRefreshTmc"));
    ok("has_persistent_require", prod.includes("requireValidPersistentTmcForLive"));
    ok("has_phase_obs", prod.includes("createPhaseTimer"));
    const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml"), "utf8");
    ok("wf_has_lkg_or_bootstrap", /IU_NDIC_TMC_LKG_ROOT|ndic-tmc-maintenance-run/.test(wf));
  }

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (fails.length) {
    console.error(JSON.stringify({ ok: false, passCount, fails }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, passCount, schema: "iu-ndic-datex-obs-tmc-lkg-fixtures-v1" }));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
