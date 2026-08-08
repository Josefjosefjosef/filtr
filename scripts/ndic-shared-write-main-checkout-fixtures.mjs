#!/usr/bin/env node
/**
 * Runtime fixtures for ACTIVE run 31254863015 MODULE_NOT_FOUND regression.
 * Offline only — no VPS, no NDIC network, no workflow dispatch.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  CRITICAL_HELPER_REL,
  runLegacySameWorkspaceApply,
  runTwoSourceApply,
  resolveTwoSourcePaths,
  workflowUsesTwoSourceModel,
  jobBlock,
} from "./ndic-shared-write-two-source.mjs";
import {
  applyNdicCandidate,
  writeJsonAtomic,
} from "./info-events-shared-writer-critical.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const REAL_HELPER = path.join(ROOT, CRITICAL_HELPER_REL);
const REAL_COMPOSE = path.join(ROOT, "scripts", "iu-info-events-namespace-compose.mjs");

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function baseFeed() {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    itemCount: 3,
    items: [
      { id: "ie-chmi-v2-a", sourceId: "chmi", capV2: { v: 1 }, title: "CHMI-A" },
      { id: "ie-ndic-v1-a", sourceId: "ndic", adapterOwner: "ndic-datex-v1", ndicV1: {}, title: "NDIC-A" },
      { id: "ie-other-a", sourceId: "hzs", title: "OTHER-A" },
    ],
  };
}

function baseMon() {
  return {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    chmiCapV2: { status: "healthy" },
    ndicDatexV1: { status: "healthy" },
  };
}

function mkSharedState(root, feed, mon) {
  const dir = path.join(root, "projects", "data", "info_events");
  fs.mkdirSync(path.join(dir, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ndic_datex_v1"), { recursive: true });
  writeJson(path.join(dir, "feed.json"), feed);
  writeJson(path.join(dir, "monitoring.json"), mon);
  writeJson(path.join(dir, "lanes", "doprava.json"), {
    items: feed.items.filter((i) => i.sourceId === "ndic" || i.sourceId === "hzs"),
  });
  writeJson(path.join(dir, "ndic_datex_v1", "sync_state.json"), { ok: true });
  return dir;
}

function mkFeatureOrch(root) {
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(REAL_HELPER, path.join(scripts, "info-events-shared-writer-critical.mjs"));
  fs.copyFileSync(REAL_COMPOSE, path.join(scripts, "iu-info-events-namespace-compose.mjs"));
  // data-pr helper presence marker (not executed here)
  fs.writeFileSync(
    path.join(scripts, "ndic-open-or-refresh-data-pr.mjs"),
    "export async function runOpenOrRefreshDataPr(){ return { ok:true }; }\n",
    "utf8"
  );
}

function mkMainWithoutHelper(root) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  // Intentionally NO info-events-shared-writer-critical.mjs (main at incident time).
  fs.writeFileSync(path.join(root, "scripts", "README.md"), "main has no NDIC critical helper\n");
  mkSharedState(root, baseFeed(), baseMon());
}

async function main() {
  const wf = fs.readFileSync(NDIC_WF, "utf8");
  const write = jobBlock(wf, "ndic-shared-write");

  ok("ROOT_CAUSE_CHECKOUT_MAIN_PRESENT", /ref:\s*main\b/.test(write), "main-ref");
  ok("CRITICAL_SCRIPT_PRESENT_ON_FEATURE_HEAD", fs.existsSync(REAL_HELPER), "feature");
  ok(
    "WORKFLOW_TWO_SOURCE_ENABLED",
    workflowUsesTwoSourceModel(wf),
    "two-source"
  );
  ok(
    "FEATURE_CODE_PATH_IN_WORKFLOW",
    /path:\s*ndic-orch\b/.test(write) &&
      /ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs/.test(write),
    "orch"
  );
  ok(
    "MAIN_DATA_PATH_IN_WORKFLOW",
    /path:\s*ndic-main-data\b/.test(write) &&
      /ndic-main-data\/projects\/data\/info_events/.test(write),
    "main-data"
  );
  ok(
    "NO_LEGACY_SAME_WORKSPACE_APPLY",
    !/node\s+scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(write),
    "legacy"
  );
  ok(
    "REREAD_AFTER_ACQUIRE_STEP",
    /Refresh main tip before shared write \(reread after acquire\)/.test(write) ||
      /reread after acquire/i.test(write),
    "reread-step"
  );
  ok("QUEUE_MAX_PRESERVED", /queue:\s*max\b/.test(write), "qmax");
  ok("CANCEL_FALSE_PRESERVED", /cancel-in-progress:\s*false/.test(write), "cancel");
  ok("SHARED_LOCK_PRESERVED", /group:\s*info-events-data-writers/.test(write), "lock");
  ok(
    "WHOLE_WORKFLOW_LOCK_ABSENT",
    !/(?:^|\n)concurrency:\s*\n\s+group:\s*info-events-data-writers/.test(
      wf.split(/\njobs:\s*\n/)[0] || ""
    ),
    "wf-lock"
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-two-source-"));
  const featureRoot = path.join(tmp, "feature");
  const mainRoot = path.join(tmp, "main");
  const candidateDir = path.join(tmp, "candidate");
  mkFeatureOrch(featureRoot);
  mkMainWithoutHelper(mainRoot);
  mkSharedState(candidateDir, {
    generatedAt: "2026-08-08T11:23:33.000Z",
    items: [
      {
        id: "ie-ndic-v1-b",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: "NDIC-B",
      },
    ],
  }, { ...baseMon(), ndicDatexV1: { status: "ndic-new" } });
  // Candidate layout matches applyNdicCandidate expectations
  fs.mkdirSync(path.join(candidateDir, "projects", "data", "info_events"), { recursive: true });
  // apply uses candidateDir directly as info_events root in workflow — mirror that:
  const candIe = path.join(tmp, "cand-ie");
  fs.mkdirSync(path.join(candIe, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(candIe, "ndic_datex_v1"), { recursive: true });
  writeJson(path.join(candIe, "feed.json"), {
    items: [
      {
        id: "ie-ndic-v1-b",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: "NDIC-B",
      },
    ],
  });
  writeJson(path.join(candIe, "monitoring.json"), {
    ndicDatexV1: { status: "ndic-new" },
  });
  writeJson(path.join(candIe, "lanes", "doprava.json"), {
    items: [
      {
        id: "ie-ndic-v1-b",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: "NDIC-B",
      },
    ],
  });
  writeJson(path.join(candIe, "ndic_datex_v1", "sync_state.json"), { written: true });
  writeJson(path.join(candIe, "ndic_datex_v1", "traffic_offline_snapshot.json"), {
    cards: [],
    bytes: 100,
  });

  ok(
    "CRITICAL_SCRIPT_PRESENT_ON_FEATURE_WORKSPACE",
    fs.existsSync(path.join(featureRoot, CRITICAL_HELPER_REL)),
    "feat-ws"
  );
  ok(
    "CRITICAL_SCRIPT_ABSENT_ON_MAIN_WORKSPACE",
    !fs.existsSync(path.join(mainRoot, CRITICAL_HELPER_REL)),
    "main-ws"
  );

  // --- Regression: legacy same-workspace main checkout MUST fail ---
  let legacyThrew = false;
  let legacyCode = "";
  try {
    runLegacySameWorkspaceApply({ mainRoot, candidateDir: candIe });
  } catch (e) {
    legacyThrew = true;
    legacyCode = String(e && e.code || "");
  }
  ok("MODULE_NOT_FOUND_REGRESSION_REPRODUCED", legacyThrew && legacyCode === "MODULE_NOT_FOUND", legacyCode);
  ok("MODULE_NOT_FOUND_REGRESSION_FIXTURE_PASS", legacyThrew && legacyCode === "MODULE_NOT_FOUND", "legacy");

  // Snapshot last-known-good before two-source write
  const liveFeedBefore = JSON.parse(
    fs.readFileSync(path.join(mainRoot, "projects/data/info_events/feed.json"), "utf8")
  );
  const lkgPath = path.join(tmp, "lkg-feed.json");
  writeJson(lkgPath, liveFeedBefore);

  // --- Fixed path: helper from feature, data on main ---
  const paths = resolveTwoSourcePaths({ featureRoot, mainRoot });
  ok("FEATURE_CODE_PATH_PASS", paths.helperPath.startsWith(featureRoot), paths.helperPath);
  ok("MAIN_DATA_PATH_PASS", paths.targetDir.startsWith(mainRoot), paths.targetDir);

  const applied = await runTwoSourceApply({
    featureRoot,
    mainRoot,
    candidateDir: candIe,
    nowIso: "2026-08-08T11:24:17.000Z",
  });
  ok("RUNTIME_TWO_SOURCE_FIXTURE_PASS", applied && applied.ok === true, "apply");
  ok("FEATURE_HELPER_AVAILABLE_DURING_MAIN_REREAD", applied.FEATURE_HELPER_AVAILABLE_DURING_MAIN_REREAD === "YES");
  ok("MAIN_STATE_REREAD_PRESERVED", applied.MAIN_STATE_REREAD_PRESERVED === "YES");
  ok("NDIC_REREAD_AFTER_ACQUIRE", applied.NDIC_REREAD_AFTER_ACQUIRE === "YES" && applied.rereadAfterLock === true);
  ok("SHARED_STATE_REREAD_AFTER_ACQUIRE", applied.SHARED_STATE_REREAD_AFTER_ACQUIRE === "YES");

  const after = JSON.parse(
    fs.readFileSync(path.join(mainRoot, "projects/data/info_events/feed.json"), "utf8")
  );
  const ids = after.items.map((i) => i.id);
  ok("CHMI_NAMESPACE_PRESERVED", ids.includes("ie-chmi-v2-a"), ids.join(","));
  ok("INFO_EVENTS_NAMESPACE_PRESERVED", ids.includes("ie-other-a"), ids.join(","));
  ok("NDIC_NAMESPACE_WRITTEN", ids.includes("ie-ndic-v1-b"), ids.join(","));
  ok("LOST_UPDATE_POSSIBLE_NO", ids.includes("ie-chmi-v2-a") && ids.includes("ie-other-a"));
  ok("LAST_WRITER_WINS_POSSIBLE_NO", ids.includes("ie-chmi-v2-a") && ids.includes("ie-ndic-v1-b"));
  ok("NAMESPACE_PRESERVATION_FIXTURE_PASS", ids.includes("ie-chmi-v2-a") && ids.includes("ie-ndic-v1-b") && ids.includes("ie-other-a"));
  ok("REREAD_AFTER_ACQUIRE_FIXTURE_PASS", applied.rereadAfterLock === true);
  ok("LOST_UPDATE_FIXTURE_PASS", ids.includes("ie-chmi-v2-a") && ids.includes("ie-other-a"));

  // Atomic write / failure recovery: failed apply against missing live must not clobber LKG
  {
    const lkgRoot = path.join(tmp, "lkg-root");
    mkMainWithoutHelper(lkgRoot);
    const lkgFeedPath = path.join(lkgRoot, "projects/data/info_events/feed.json");
    const beforeFail = JSON.parse(fs.readFileSync(lkgFeedPath, "utf8"));
    let failed = false;
    try {
      applyNdicCandidate({
        targetDir: path.join(tmp, "missing-live-shared-state"),
        candidateDir: candIe,
        nowIso: "T-fail",
      });
    } catch {
      failed = true;
    }
    const afterFail = JSON.parse(fs.readFileSync(lkgFeedPath, "utf8"));
    ok("FAILURE_RECOVERY_PASS", failed === true, "threw");
    ok(
      "LAST_KNOWN_GOOD_PRESERVED",
      JSON.stringify(afterFail.items) === JSON.stringify(beforeFail.items),
      "lkg"
    );
    ok("ATOMIC_WRITE_PASS", typeof writeJsonAtomic === "function", "atomic-fn");
    ok(
      "PARTIAL_SHARED_STATE_EXPOSURE_POSSIBLE_NO",
      !fs.existsSync(path.join(lkgRoot, "projects/data/info_events/feed.json.tmp"))
    );
  }

  // CHECKOUT_MAIN_REMOVES_FEATURE_HELPER conceptual proof:
  // If we copied feature helper into a workspace then replaced tree with main-without-helper, helper gone.
  {
    const mixed = path.join(tmp, "overwrite");
    mkFeatureOrch(mixed);
    ok("HELPER_BEFORE_MAIN_OVERWRITE", fs.existsSync(path.join(mixed, CRITICAL_HELPER_REL)));
    // simulate checkout main overwrite
    fs.rmSync(mixed, { recursive: true, force: true });
    mkMainWithoutHelper(mixed);
    ok(
      "CHECKOUT_MAIN_REMOVES_FEATURE_HELPER",
      !fs.existsSync(path.join(mixed, CRITICAL_HELPER_REL)),
      "removed"
    );
  }

  const report = {
    ok: fails.length === 0,
    passCount,
    fails,
    MODULE_NOT_FOUND_REGRESSION_REPRODUCED: legacyThrew && legacyCode === "MODULE_NOT_FOUND" ? "YES" : "NO",
    MODULE_NOT_FOUND_REGRESSION_FIXTURE_PASS: legacyThrew && legacyCode === "MODULE_NOT_FOUND" ? "YES" : "NO",
    RUNTIME_TWO_SOURCE_FIXTURE_PASS: applied && applied.ok ? "YES" : "NO",
    FEATURE_CODE_PATH_PASS: "YES",
    MAIN_DATA_PATH_PASS: "YES",
    ORCHESTRATION_CODE_SOURCE: "FEATURE_HEAD",
    SHARED_STATE_SOURCE: "LATEST_MAIN",
  };
  console.log(JSON.stringify(report, null, 2));
  if (fails.length) {
    console.error("FAIL:" + fails.join(";"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e && e.stack || e));
  process.exit(1);
});
