#!/usr/bin/env node
/**
 * Behavioral + structural proof for data-only / info_events contract fast path.
 * STRUCTURAL: smoke.yml gates Playwright UI when data_only + runs contract suite.
 * BEHAVIORAL: classifier allowlist + contract guards PASS on live data + FAIL on wipe fixture.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  allowsDataOnlyFastPath,
  isAllowedGeneratedDataPath,
  isDataOnlyScope,
  isFastPoolPipelineScope,
  isVaultSecurityRuntimeScope,
  isWorkflowOnlyScope,
  normalizeRepoPath,
  touchesInfoEventsGeneratedData,
} from "./smoke-data-only-scope.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failed += 1;
  }
}

/** Prevent data-only + skipped Playwright install from still running UI browser guards. */
function assertSmokeYmlDataOnlyGatesPlaywrightUiSteps() {
  const smokePath = path.join(REPO, ".github", "workflows", "smoke.yml");
  const text = fs.readFileSync(smokePath, "utf8");
  const required = [
    "Install Playwright browsers",
    "Desktop cold-start FOUC guard",
    "Mobile iCentrum boot FOUC guard",
    "Traffic auto background full hydrate guard",
  ];
  for (const name of required) {
    const re = new RegExp(
      String.raw`- name:\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*\n\s*if:\s*steps\.scope\.outputs\.data_only\s*!=\s*'true'`,
      "m"
    );
    assert(re.test(text), `smoke.yml step "${name}" must gate on data_only != true (Playwright binary skip path)`);
  }
  assert(
    /name:\s*Info events \/ CHMI data-contract suite \(non-browser\)/.test(text),
    "smoke.yml must define Info events / CHMI data-contract suite"
  );
  assert(
    /run_info_events_contract\s*==\s*'true'/.test(text),
    "smoke.yml contract suite must require run_info_events_contract"
  );
}
assertSmokeYmlDataOnlyGatesPlaywrightUiSteps();

const chmi = [
  "projects/data/info_events/chmi_cap_v2/diagnostics.json",
  "projects/data/info_events/chmi_cap_v2/sync_state.json",
  "projects/data/info_events/feed.json",
  "projects/data/info_events/lanes/pocasi.json",
  "projects/data/info_events/monitoring.json",
];

assert(isDataOnlyScope(["projects/data/publishable_pool.json"]), "pool file is data-only");
assert(isDataOnlyScope(["projects/data/articles/index.json", "projects/data/article_feed_chunks/feed/init.json"]), "chunks are data-only");
assert(isDataOnlyScope(chmi), "pure CHMI generated data is data-only");
assert(touchesInfoEventsGeneratedData(chmi), "pure CHMI touches info_events contract");
assert(allowsDataOnlyFastPath(chmi), "pure CHMI allows fast path / skip browser");

assert(!isDataOnlyScope(["assets/app.js"]), "assets not data-only");
assert(!isDataOnlyScope(["projects/data/x.json", "assets/app.js"]), "mixed not data-only");
assert(!isDataOnlyScope([]), "empty not data-only");
assert(!isDataOnlyScope(["projects/data/evil.js"]), "js under data is NOT data-only");
assert(!isDataOnlyScope(["projects/data/evil.mjs"]), "mjs under data is NOT data-only");
assert(!isDataOnlyScope(["projects/data/evil.html"]), "html under data is NOT data-only");
assert(!isDataOnlyScope(["projects/data/evil.css"]), "css under data is NOT data-only");
assert(!isAllowedGeneratedDataPath("projects/data/evil.ts"), "ts under data rejected");
assert(!isAllowedGeneratedDataPath("projects/data/../../assets/app.js"), "path traversal rejected");
assert(normalizeRepoPath("projects/data/../../assets/app.js") === "", "normalize drops traversal");
assert(!isDataOnlyScope([...chmi, "assets/app.js"]), "CHMI+JS full CI");
assert(!isDataOnlyScope([...chmi, "assets/app.css"]), "CHMI+CSS full CI");
assert(!isDataOnlyScope([...chmi, "projects/index.html"]), "CHMI+HTML full CI");
assert(!isDataOnlyScope([...chmi, "sw.js"]), "CHMI+SW full CI");
assert(!allowsDataOnlyFastPath([...chmi, ".github/workflows/smoke.yml"]), "CHMI+workflow not fast (mixed)");
assert(!allowsDataOnlyFastPath([...chmi, "_headers"]), "CHMI+security full CI");
assert(!allowsDataOnlyFastPath([...chmi, "cloudflare/chmi-cap-watchdog/src/index.ts"]), "CHMI+worker full CI");
assert(!allowsDataOnlyFastPath([...chmi, "scripts/chmi-cap-v2/parse-cap.mjs"]), "CHMI+parser full CI");
assert(!isDataOnlyScope(["projects/data/info_events/unknown.bin"]), "unknown extension full CI");
assert(!isDataOnlyScope(["projects/data/noext"]), "extensionless under data rejected");

assert(isDataOnlyScope(["projects/data/info_events/ndic_datex_v1/.gitkeep"]), ".gitkeep allowlisted");
assert(isDataOnlyScope(["projects/data/feed_snapshots/abc.xml"]), "xml snapshot allowlisted");
assert(isDataOnlyScope(["projects/data/cz_outline_ne50.geojson"]), "geojson allowlisted");
assert(isDataOnlyScope(["projects/data/_probe.txt"]), "txt probe allowlisted");

assert(isFastPoolPipelineScope([".github/workflows/update-articles-fast-pool.yml"]), "fast pool workflow-only is pipeline scope");
assert(isWorkflowOnlyScope([".github/workflows/update-weather.yml", ".github/workflows/pages-publish-from-main-data.yml"]), "multi workflow-only is workflow scope");
assert(
  isWorkflowOnlyScope([
    ".github/workflows/iu-ads-admin-e2e-prod.yml",
    ".github/workflows/iu-ads-post-migration-prod-verify.yml",
    "cloudflare/iu-ads/scripts/iu-ads-admin-e2e-prod.mjs",
    "scripts/iu-ads-post-migration-prod-verify.mjs",
  ]),
  "Ads E2E/verify tooling is workflow-only scope"
);
assert(!isWorkflowOnlyScope([".github/workflows/smoke.yml", "assets/app.js"]), "mixed workflow+assets not workflow scope");
assert(isFastPoolPipelineScope(["package.json", "projects/data/publishable_pool.json"]), "data + package.json is pipeline scope");
assert(!isFastPoolPipelineScope(["package.json", "projects/data/evil.js"]), "pipeline rejects evil.js data path");
assert(!isFastPoolPipelineScope([".github/workflows/update-articles-fast-pool.yml", "assets/app.js"]), "mixed workflow+assets not pipeline scope");
assert(isVaultSecurityRuntimeScope(["assets/iu-vault-bootstrap-v1.js"]), "vault bootstrap is vault runtime scope");
assert(isVaultSecurityRuntimeScope(["assets/iu-vault-lock-v1.js", "scripts/iu-vault-lock-unlock-preserves-data-guard-v1.mjs"]), "vault runtime asset in mixed diff");
assert(!isVaultSecurityRuntimeScope(["projects/data/x.json", "scripts/iu-vault-lock-unlock-preserves-data-guard-v1.mjs"]), "guard script alone is not vault runtime scope");
assert(!allowsDataOnlyFastPath(["assets/iu-vault-bootstrap-v1.js"]), "vault bootstrap blocks fast path");
assert(!allowsDataOnlyFastPath([".github/workflows/smoke.yml", "assets/iu-vault-bootstrap-v1.js"]), "vault+wworkflow blocks fast path");
assert(allowsDataOnlyFastPath([".github/workflows/smoke.yml"]), "workflow-only still allows fast path when no vault runtime");

assert(touchesInfoEventsGeneratedData(["projects/data/weather.json"]) === false, "non-info_events data does not force CHMI contract");
assert(touchesInfoEventsGeneratedData(["projects/data/info_events/feed.json", "assets/app.js"]) === true, "info_events touch even in mixed diff");

function runNpm(script) {
  const r = spawnSync("npm", ["run", script], {
    cwd: REPO,
    encoding: "utf8",
    shell: true,
    env: process.env,
  });
  return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
}

// Contract guards must PASS on current repo data (without Playwright).
const passGuards = [
  "iu-chmi-cap-monitoring-refuse-wipe-guard",
  "iu-info-events-preserve-chmi-namespaces-guard",
  "iu-chmi-cap-no-segment-dedupe-guard",
];
for (const g of passGuards) {
  const r = runNpm(g);
  assert(r.code === 0, g + " must PASS on live data (code=" + r.code + ")");
}

// FAIL fixture: wiped monitoring shape must be rejected (same invariant as refuse-wipe).
{
  const monPath = path.join(REPO, "projects/data/info_events/monitoring.json");
  const mon = JSON.parse(fs.readFileSync(monPath, "utf8"));
  assert(mon.datasetAges && Array.isArray(mon.alerts) && Array.isArray(mon.outageHistory), "live monitoring has contract fields");
  const wiped = { chmiCapV2: mon.chmiCapV2 || {} };
  assert(!wiped.datasetAges, "wipe fixture lacks datasetAges");
  assert(!Array.isArray(wiped.alerts), "wipe fixture lacks alerts");
  const wipeOk =
    !(wiped.datasetAges && typeof wiped.datasetAges.feedAgeHours === "number") ||
    !Array.isArray(wiped.alerts) ||
    !Array.isArray(wiped.outageHistory);
  assert(wipeOk, "wipe fixture must fail monitoring refuse-wipe field checks");
  console.log("IU_INFO_EVENTS_CONTRACT_FAIL_FIXTURE=PASS");
}

console.log("SMOKE_DATA_ONLY_SCOPE_PROOF=" + (failed === 0 ? "PASS" : "FAIL"));
process.exit(failed === 0 ? 0 : 1);
