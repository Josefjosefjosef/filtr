#!/usr/bin/env node
/**
 * Master traffic regression runner — executes the known iu-traffic guard/fixture suite
 * and prints aggregate PASS/FAIL counts. Pure local, no network.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SUITES = [
  "iu-traffic-card-unified-fixtures",
  "iu-traffic-collapsed-km-guard",
  "iu-traffic-object-preservation-guard",
  "iu-traffic-urban-numbered-road-parse-guard",
  "iu-traffic-fact-preservation-guard",
  "iu-traffic-municipality-parenthetical-multi-road-guard",
  "iu-traffic-km-range-roadwork-detail-guard",
  "iu-traffic-direction-abbrev-rich-situation-guard",
  "iu-traffic-beroun-multi-street-work-reason-guard",
  "iu-traffic-decin-narrowed-lanes-reason-guard",
  "iu-traffic-karlovy-vary-closure-access-guard",
  "iu-traffic-i38-km-range-situation-guard",
  "iu-traffic-hradec-accident-i57-guard",
  "iu-traffic-accident-participants-may-block-guard",
  "iu-traffic-obstruction-stationary-vehicle-guard",
  "iu-traffic-obstacle-oil-cleanup-facts-guard",
  "iu-traffic-oversize-route-waypoint-guard",
  "iu-traffic-accident-dod-moto-investigation-guard",
  "iu-traffic-dod-divocak-participant-specificity-guard",
  "iu-traffic-d4-km-range-maintenance-guard",
  "iu-traffic-exit-ramp-tokenize-guard",
  "iu-traffic-motorway-direction-exit-order-guard",
  "iu-traffic-direction-congestion-exactness-guard",
  "iu-traffic-explicit-road-delay-exit-guard",
  "iu-traffic-prague-jizni-spojka-smv-header-guard",
  "iu-traffic-municipality-street-accident-izs-guard",
  "iu-traffic-broken-vehicle-delay-header-guard",
  "iu-traffic-broken-down-vehicle-vs-generic-accident-worksite-guard",
  "iu-traffic-roadwork-lane-restriction-municipality-parts-guard",
  "iu-traffic-future-traffic-impact-tense-guard",
  "iu-traffic-municipality-relation-oa-accident-guard",
  "iu-traffic-intersection-locality-precedence-guard",
  "iu-traffic-km-phrase-not-municipality-guard",
];

const rows = [];
const t0 = Date.now();
for (const name of SUITES) {
  const started = Date.now();
  const r = spawnSync("npm", ["run", name], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  const pass = r.status === 0;
  rows.push({
    script: name,
    pass,
    exit: r.status == null ? -1 : r.status,
    ms: Date.now() - started,
  });
}
const passN = rows.filter((x) => x.pass).length;
const failN = rows.length - passN;
const out = {
  runner: "iu-traffic-master-regression-runner",
  total: rows.length,
  pass: passN,
  fail: failN,
  PREVIOUSLY_CORRECT_CASES_BROKEN: failN,
  elapsedMs: Date.now() - t0,
  rows,
};
console.log(JSON.stringify(out, null, 2));
if (failN) {
  console.log("IU_TRAFFIC_MASTER_REGRESSION_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_MASTER_REGRESSION_PASS");
