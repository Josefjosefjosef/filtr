#!/usr/bin/env node
/**
 * Offline Phase 3H coverage + auth selftest (no live CJ HTTP required for core asserts).
 * When live pack exists under %TEMP%, also asserts coverage numbers + DISARMED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  reconcileCjPartnerCoverage,
  runAuthErrorKeepsDisarmedScenario,
  stripCjUrlTimestamp,
  matchCatalogByName,
  parseCatalogPartners,
  normalizePartnerBrand,
} from "./iu-cj-affiliate-phase3h-coverage-reconcile-v1.mjs";
import { runAutomation24x7Matrix, runAuthErrorKeepsDisarmedInline } from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const authA = runAuthErrorKeepsDisarmedInline();
const authB = runAuthErrorKeepsDisarmedScenario();
expect("auth_inline_pass", authA.pass === true, authA.detail);
expect("auth_scenario_pass", authB.pass === true, authB.detail);
expect("auth_detail_lkg", authA.detail?.lkgIntact === true);

const ops = runAutomation24x7Matrix({});
expect("ops_14", ops.scenarioCount === 14, { n: ops.scenarioCount });
expect("ops_all_pass", ops.ok === true && ops.failed.length === 0, { failed: ops.failed });
expect(
  "ops_auth_pass",
  ops.scenarios.some((s) => s.id === "auth_error_keeps_disarmed" && s.pass === true)
);

const stripped = stripCjUrlTimestamp(
  "https://www.anrdoezrs.net/click-101883843-17367825-1792326753000"
);
expect("strip_ts", stripped === "https://www.anrdoezrs.net/click-101883843-17367825");
expect("strip_still_cj", isCjTrackingUrl(stripped) === true);

const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const parsed = parseCatalogPartners(catalogSrc);
expect("catalog_partners", parsed.count >= 100);
const auto = matchCatalogByName("Autohotarek.cz", parsed.byTitle);
expect("autohotarek_baked", auto && /click-101883843-/.test(auto.url));
const nova = matchCatalogByName("Novakid INT", parsed.byTitle);
expect("novakid_no_false_match", nova == null);

const map = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"), "utf8")
);
expect("klik_pojisteni", map["5871720"] === "aff-pojisteni");
expect("royal_sperky", map["5819507"] === "aff-sperky-hodinky");
expect("lidl_jidlo", map["5954793"] === "aff-jidlo");

const mp = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), "utf8")
);
const lidl = (mp.partners || []).find((p) => String(p.advertiserId) === "5954793");
expect("lidl_managed", lidl && lidl.sectionId === "aff-jidlo" && lidl.active !== false);
expect("lidl_url", lidl && isCjTrackingUrl(lidl.url));

const review = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-manual-review-v1.json"), "utf8")
);
expect("live_disarmed", review.liveEnabled === false && review.publishArmed === false);
expect("mr_two", (review.remainingManualReview || []).length === 2);
expect(
  "mr_novakid_gearup",
  (review.remainingManualReview || []).every((r) =>
    ["5578976", "7804601"].includes(String(r.advertiserId))
  )
);
expect(
  "royal_not_mr",
  !(review.remainingManualReview || []).some((r) => String(r.advertiserId) === "5819507")
);

let liveSummary = { ran: false };
const livePath = path.join(
  process.env.TEMP || "",
  "iu-cj-phase3e-validation",
  "readiness",
  "iu-affiliate-cj-publication-readiness-live.json"
);
if (fs.existsSync(livePath)) {
  const liveDoc = JSON.parse(fs.readFileSync(livePath, "utf8"));
  const recon = reconcileCjPartnerCoverage({ liveDoc, root: ROOT });
  liveSummary = {
    ran: true,
    counts: recon.counts,
    missing: recon.missingButton.map((m) => m.advertiserId + ":" + m.reason),
  };
  expect("live_disarmed2", recon.liveEnabled === false);
  expect("joined_166", recon.counts.joined === 166);
  expect("with_button_ge_162", recon.counts.withButton >= 162);
  expect("lidl_not_missing", !recon.missingButton.some((m) => String(m.advertiserId) === "5954793"));
  expect(
    "coupons_linked_all_ready",
    recon.counts.couponsLinkedToButton === recon.counts.couponsPublicationReady,
    recon.counts
  );
  expect(
    "actions_linked_all_ready",
    recon.counts.actionsLinkedToButton === recon.counts.actionsPublicationReady,
    recon.counts
  );
  expect("no_dup_enrich_note", recon.enrichCandidatesDoNotDuplicate >= 0);
}

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3H_COVERAGE_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    ops: { ok: ops.ok, passed: ops.passed, scenarioCount: ops.scenarioCount },
    liveSummary,
    normSample: normalizePartnerBrand("Nature's Finest"),
  })
);
process.exit(ok ? 0 : 1);
