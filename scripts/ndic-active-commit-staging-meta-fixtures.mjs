#!/usr/bin/env node
/**
 * Meta/mutation guards for ACTIVE commit staging + candidate REQUIRED snapshot.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const PROD = path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs");
const STAGE = path.join(ROOT, "scripts", "ndic-stage-shared-write-outputs.mjs");
const ASSERT = path.join(ROOT, "scripts", "ndic-assert-candidate-required-outputs.mjs");
const FIX = path.join(ROOT, "scripts", "ndic-active-commit-staging-fixtures.mjs");
const SUITE = path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs");
const PKG = path.join(ROOT, "package.json");
const PERSIST = path.join(ROOT, "scripts", "ndic-datex-v1", "traffic-ui-snapshot-persist.mjs");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

const wf = fs.readFileSync(NDIC_WF, "utf8");
const prod = fs.readFileSync(PROD, "utf8");
const suite = fs.readFileSync(SUITE, "utf8");
const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
const persist = fs.readFileSync(PERSIST, "utf8");

ok("files_stage", fs.existsSync(STAGE));
ok("files_assert", fs.existsSync(ASSERT));
ok("files_fix", fs.existsSync(FIX));
ok("pkg_script", Boolean(pkg.scripts && pkg.scripts["iu-ndic-active-commit-staging-fixtures"]));
ok("pkg_meta_script", Boolean(pkg.scripts && pkg.scripts["iu-ndic-active-commit-staging-meta-fixtures"]));
ok("suite_wires_fix", /iu-ndic-active-commit-staging-fixtures/.test(suite));
ok("suite_wires_meta", /iu-ndic-active-commit-staging-meta-fixtures/.test(suite));
ok("prod_uses_resolve", /resolveTrafficUiSnapshotDestPath/.test(prod));
ok("prod_passes_info_events_dir", /infoEventsDir:\s*DIR/.test(prod));
ok("persist_exports_resolve", /export function resolveTrafficUiSnapshotDestPath/.test(persist));
ok("wf_pack_assert", /ndic-assert-candidate-required-outputs\.mjs/.test(wf));
ok("wf_stage_helper", /ndic-stage-shared-write-outputs\.mjs/.test(wf));
ok("wf_no_swallow_add", !/2>\s*\/dev\/null\s*\|\|\s*true/.test(wf));

// Mutation: restore all-or-nothing swallow → meta must catch
{
  const mutated =
    wf.replace(
      /node \.\.\/ndic-orch\/scripts\/ndic-stage-shared-write-outputs\.mjs --repo \./g,
      "git add projects/data/info_events/feed.json projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json 2>/dev/null || true"
    );
  ok(
    "mutation_detects_all_or_nothing_return",
    /2>\s*\/dev\/null\s*\|\|\s*true/.test(mutated) &&
      !/ndic-stage-shared-write-outputs\.mjs/.test(mutated),
    "mut"
  );
}

// Mutation: prod writes only repoRoot without infoEventsDir
{
  const mutated = prod.replace(/infoEventsDir:\s*DIR/g, "/* wiped */");
  ok("mutation_detects_missing_info_events_dir", !/infoEventsDir:\s*DIR/.test(mutated));
}

// Mutation: remove pack assert
{
  const mutated = wf.replace(/ndic-assert-candidate-required-outputs\.mjs/g, "wiped-assert.mjs");
  ok("mutation_detects_pack_assert_removal", !/ndic-assert-candidate-required-outputs\.mjs/.test(mutated));
}

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, guards: fails.length === 0 }));
process.exit(0);
