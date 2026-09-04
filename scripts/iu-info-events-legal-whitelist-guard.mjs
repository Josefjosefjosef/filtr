#!/usr/bin/env node
/**
 * Guard: InfoUzel legal whitelist + production publish gate for info_events (phase-2).
 * Run: node scripts/iu-info-events-legal-whitelist-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  APPROVED_STATUSES,
  ALL_STATUSES,
  canPublishFromSource,
  isApprovedStatus,
  loadLegalRegistry,
  loadSourceRegistry,
} from "./iu-info-events-legal-registry-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function fail(msg) {
  fails.push(msg);
}

const legalPath = path.join(REPO, "projects/data/info_events/legal_source_registry.json");
const srcPath = path.join(REPO, "projects/data/info_events/source_registry.json");
const feedPath = path.join(REPO, "projects/data/info_events/feed.json");
const docsPath = path.join(REPO, "docs/info-system-v1/12-legal-whitelist-audit.md");
const phase2Doc = path.join(REPO, "docs/info-system-v1/14-legal-phase2-decisions.md");
const nkodInv = path.join(REPO, "docs/info-system-v1/13-nkod-deep-dive-inventory.json");
const publicPage = path.join(REPO, "projects/zdroje-a-licence/index.html");
const reauditScript = path.join(REPO, "scripts/iu-info-events-legal-reaudit.mjs");

if (!fs.existsSync(legalPath)) fail("missing:legal_source_registry.json");
if (!fs.existsSync(docsPath)) fail("missing:docs/12-legal-whitelist-audit.md");
if (!fs.existsSync(phase2Doc)) fail("missing:docs/14-legal-phase2-decisions.md");
if (!fs.existsSync(nkodInv)) fail("missing:docs/13-nkod-deep-dive-inventory.json");
if (!fs.existsSync(publicPage)) fail("missing:public_zdroje_a_licence_page");
if (!fs.existsSync(reauditScript)) fail("missing:legal_reaudit_script");

const legal = loadLegalRegistry(REPO);
const registry = loadSourceRegistry(REPO);
const feed = JSON.parse(fs.readFileSync(feedPath, "utf8"));

if (!legal.gate || legal.gate.enforceHard !== true) fail("gate:enforceHard_must_be_true");
if (legal.gate.phase2EvidenceRequired !== true) fail("gate:phase2EvidenceRequired");
if (legal.gate.requireLicenseUrl !== true) fail("gate:requireLicenseUrl");
if (!Array.isArray(legal.gate.allowedStatuses) || legal.gate.allowedStatuses.length < 5) fail("gate:allowedStatuses");
for (const s of APPROVED_STATUSES) {
  if (!legal.gate.allowedStatuses.includes(s)) fail("gate:missing_allowed:" + s);
}
if (!legal.attributionTemplates || !legal.attributionTemplates.open_data_by) fail("attribution:open_data_by_missing");
if (!Array.isArray(legal.nkodDiscovery) || legal.nkodDiscovery.length < 50) fail("nkodDiscovery:min_50");

const bySource = new Map((legal.entries || []).map((e) => [e.sourceId, e]));

for (const e of registry.entries || []) {
  const L = bySource.get(e.id);
  if (!L) fail("legal_missing_for_source:" + e.id);
  else if (!ALL_STATUSES.includes(L.status)) fail("illegal_status:" + e.id + ":" + L.status);

  if (e.productionActive && e.productionApproved && e.legalStatus === "approved") {
    const gate = canPublishFromSource(e, legal);
    if (!gate.ok) fail("active_source_fails_legal_gate:" + e.id + ":" + gate.reason);
    if (!isApprovedStatus(L.status)) fail("active_not_approved_status:" + e.id + ":" + L.status);
    if (!/^https:\/\//i.test(String(L.licenseUrl || ""))) fail("active_missing_licenseUrl:" + e.id);
    if (!Array.isArray(L.fieldAllowlist) || L.fieldAllowlist.length < 2) fail("active_missing_fieldAllowlist:" + e.id);
    const hasExt = (L.evidence || []).some((x) => (typeof x === "string" ? /^https:/i.test(x) : x && /^https:/i.test(x.url)));
    if (!hasExt) fail("active_missing_external_evidence:" + e.id);
  }
}

// No interim APPROVED_WITH_SPECIFIC_CONDITIONS without licenseUrl
for (const e of legal.entries || []) {
  if (e.status === "APPROVED_WITH_SPECIFIC_CONDITIONS" && !/^https:\/\//i.test(String(e.licenseUrl || ""))) {
    fail("interim_specific_without_licenseUrl:" + e.sourceId);
  }
}

for (const id of ["ct24", "irozhlas"]) {
  const e = (registry.entries || []).find((x) => x.id === id);
  const L = bySource.get(id);
  if (e && e.productionActive) fail("public_media_must_not_be_active:" + id);
  if (L && isApprovedStatus(L.status)) fail("public_media_must_not_be_approved_yet:" + id);
}

for (const id of ["seznamzpravy", "novinky", "idnes", "aktualne", "denik", "blesk", "hn", "e15", "sportcz", "isport"]) {
  const L = bySource.get(id);
  if (!L) fail("commercial_missing_legal:" + id);
  else if (L.status !== "REJECTED" && !String(L.status).startsWith("REJECTED_")) {
    fail("commercial_not_rejected:" + id + ":" + L.status);
  }
}

const activePublishable = new Set(
  (registry.entries || []).filter((e) => canPublishFromSource(e, legal).ok).map((e) => e.id)
);
if (activePublishable.size < 1) fail("no_publishable_sources");

let illegalFeed = 0;
for (const it of feed.items || []) {
  const sid = String(it.sourceId || "");
  if (!sid) continue;
  if (!activePublishable.has(sid)) {
    illegalFeed += 1;
    if (illegalFeed <= 8) fail("feed_item_from_non_publishable:" + sid);
  }
  if (!it.legal || !it.legal.approvalStatus || !it.legal.distributionId) {
    fail("feed_item_missing_legal_provenance:" + (it.id || sid));
  }
}
if (illegalFeed > 8) fail("feed_illegal_items_count:" + illegalFeed);

const refresh = fs.readFileSync(path.join(REPO, "scripts/iu-info-events-refresh.mjs"), "utf8");
if (!/canPublishFromSource|loadLegalRegistry|attachLegalProvenance/.test(refresh)) {
  fail("refresh:missing_legal_gate_wiring");
}

const page = fs.readFileSync(publicPage, "utf8");
if (!/Zdroje a licence/.test(page) || !/legal_source_registry\.public\.json/.test(page)) {
  fail("public_page:missing_markers");
}
if (/\.\.\/data\/info_events\/legal_source_registry\.json/.test(page)) {
  fail("public_page:broken_relative_full_registry");
}

for (const e of legal.entries || []) {
  if (!isApprovedStatus(e.status)) continue;
  const blob = JSON.stringify(e).toLowerCase();
  if (/cc by-nc|cc-by-nc/.test(blob) && e.commercialUseAllowed === true) {
    fail("approved_mentions_nc_license:" + e.sourceId);
  }
}

// Negative unit checks (fail-closed pure functions)
{
  const fakeSrc = { id: "chmi", productionActive: true, productionApproved: true, legalStatus: "approved" };
  const ok = canPublishFromSource(fakeSrc, legal);
  if (!ok.ok) fail("unit:chmi_should_pass:" + ok.reason);

  function mutateChmi(mutator) {
    const clone = JSON.parse(JSON.stringify(legal));
    const row = (clone.entries || []).find((e) => e.sourceId === "chmi");
    if (!row) {
      fail("unit:chmi_missing_in_registry");
      return null;
    }
    mutator(row);
    return clone;
  }

  const cases = [
    ["missing_license", (r) => { r.licenseUrl = ""; }],
    ["missing_terms", (r) => { r.termsUrl = ""; }],
    ["commercial_false", (r) => { r.commercialUseAllowed = false; }],
    ["ads_false", (r) => { r.adSupportedUseAllowed = false; }],
    ["combination_false", (r) => { r.combinationAllowed = false; }],
    ["automation_false", (r) => { r.automationAllowed = false; }],
    ["storage_false", (r) => { r.storageAllowed = false; }],
    ["display_false", (r) => { r.publicDisplayAllowed = false; }],
    ["expired_reaudit", (r) => { r.reauditDue = "2020-01-01T00:00:00.000Z"; }],
    ["suspended", (r) => { r.suspended = true; }],
    ["sharealike_incompatible", (r) => {
      r.shareAlike = true;
      r.shareAlikeCompatibleWithInfoUzel = false;
      r.odblOrShareAlikeRisk = true;
      r.status = "LEGAL_COMPATIBILITY_REVIEW_REQUIRED";
    }],
    ["unknown_status", (r) => { r.status = "NOT_A_REAL_STATUS"; }],
    ["personal_data_pending", (r) => {
      r.personalDataRisk = "high";
      r.status = "PERSONAL_DATA_REVIEW_REQUIRED";
    }],
  ];

  for (const [name, mut] of cases) {
    const clone = mutateChmi(mut);
    if (!clone) continue;
    const bad = canPublishFromSource(fakeSrc, clone);
    if (bad.ok) fail("unit:" + name + "_should_fail");
  }

  const noProv = canPublishFromSource(
    { id: "unknown-source-xyz", productionActive: true, productionApproved: true, legalStatus: "approved" },
    legal
  );
  if (noProv.ok) fail("unit:unknown_source_should_fail");

  const inactive = canPublishFromSource(
    { id: "chmi", productionActive: false, productionApproved: true, legalStatus: "approved" },
    legal
  );
  if (inactive.ok) fail("unit:inactive_source_should_fail");
}

if (fails.length) {
  console.error("[iu-info-events-legal-whitelist-guard] FAIL");
  for (const f of fails.slice(0, 80)) console.error(" -", f);
  if (fails.length > 80) console.error(" - … +" + (fails.length - 80));
  console.log("RESULT=FAIL");
  process.exit(1);
}

const active = (registry.entries || []).filter((e) => e.productionActive && e.productionApproved).length;
console.log(
  "[iu-info-events-legal-whitelist-guard] OK entries=" +
    (legal.entries || []).length +
    " approved=" +
    (legal.entries || []).filter((e) => isApprovedStatus(e.status)).length +
    " productionActive=" +
    active +
    " nkodDiscovered=" +
    (legal.nkodDiscovery || []).length +
    " feedItems=" +
    (feed.items || []).length
);
console.log("RESULT=PASS");
