#!/usr/bin/env node
/**
 * Guard: InfoUzel legal whitelist + production publish gate for info_events.
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

if (!fs.existsSync(legalPath)) fail("missing:legal_source_registry.json");
if (!fs.existsSync(docsPath)) fail("missing:docs/info-system-v1/12-legal-whitelist-audit.md");
if (!fs.existsSync(path.join(REPO, "scripts/iu-info-events-legal-registry-lib.mjs"))) {
  fail("missing:legal_registry_lib");
}
if (!fs.existsSync(path.join(REPO, "scripts/iu-info-events-legal-registry-build.mjs"))) {
  fail("missing:legal_registry_build");
}

const legal = loadLegalRegistry(REPO);
const registry = loadSourceRegistry(REPO);
const feed = JSON.parse(fs.readFileSync(feedPath, "utf8"));

if (!legal.gate || legal.gate.enforceHard !== true) fail("gate:enforceHard_must_be_true");
if (!Array.isArray(legal.gate.allowedStatuses) || legal.gate.allowedStatuses.length < 5) {
  fail("gate:allowedStatuses");
}
for (const s of APPROVED_STATUSES) {
  if (!legal.gate.allowedStatuses.includes(s)) fail("gate:missing_allowed:" + s);
}
if (!legal.attributionTemplates || !legal.attributionTemplates.gov_link_only) {
  fail("attribution:gov_link_only_missing");
}
if (!Array.isArray(legal.nkodDiscovery) || legal.nkodDiscovery.length < 3) {
  fail("nkodDiscovery:min_3");
}

const bySource = new Map((legal.entries || []).map((e) => [e.sourceId, e]));

for (const e of registry.entries || []) {
  const L = bySource.get(e.id);
  if (!L) fail("legal_missing_for_source:" + e.id);
  else if (!ALL_STATUSES.includes(L.status)) fail("illegal_status:" + e.id + ":" + L.status);

  if (e.productionActive && e.productionApproved && e.legalStatus === "approved") {
    const gate = canPublishFromSource(e, legal);
    if (!gate.ok) fail("active_source_fails_legal_gate:" + e.id + ":" + gate.reason);
    if (!isApprovedStatus(L.status)) fail("active_not_approved_status:" + e.id + ":" + L.status);
    if (L.commercialUseAllowed !== true) fail("active_commercial_false:" + e.id);
    if (L.adSupportedUseAllowed !== true) fail("active_ads_false:" + e.id);
    if (L.combinationAllowed !== true) fail("active_combination_false:" + e.id);
  }
}

// Public media must not be production-active without APPROVED_* 
for (const id of ["ct24", "irozhlas"]) {
  const e = (registry.entries || []).find((x) => x.id === id);
  const L = bySource.get(id);
  if (e && e.productionActive) fail("public_media_must_not_be_active:" + id);
  if (L && isApprovedStatus(L.status)) fail("public_media_must_not_be_approved_yet:" + id);
}

// Commercial media rejected
for (const id of ["seznamzpravy", "novinky", "idnes", "aktualne", "denik", "blesk", "hn", "e15", "sportcz", "isport"]) {
  const L = bySource.get(id);
  if (!L) fail("commercial_missing_legal:" + id);
  else if (L.status !== "REJECTED" && !String(L.status).startsWith("REJECTED_")) {
    fail("commercial_not_rejected:" + id + ":" + L.status);
  }
}

// Feed items must not come from non-publishable sources (soft: warn if present without legal block on old feed)
const activePublishable = new Set(
  (registry.entries || [])
    .filter((e) => canPublishFromSource(e, legal).ok)
    .map((e) => e.id)
);
let illegalFeed = 0;
for (const it of feed.items || []) {
  const sid = String(it.sourceId || "");
  if (!sid) continue;
  if (!activePublishable.has(sid)) {
    // Allow stale items only if source exists but is inactive — still fail if APPROVED gate says no and item lacks legal block
    const src = (registry.entries || []).find((e) => e.id === sid);
    if (src && src.productionActive) {
      illegalFeed += 1;
      if (illegalFeed <= 5) fail("feed_item_from_non_publishable_active:" + sid);
    }
  }
}
if (illegalFeed > 5) fail("feed_illegal_active_items_count:" + illegalFeed);

// Refresh must import legal gate
const refresh = fs.readFileSync(path.join(REPO, "scripts/iu-info-events-refresh.mjs"), "utf8");
if (!/canPublishFromSource|loadLegalRegistry|attachLegalProvenance/.test(refresh)) {
  fail("refresh:missing_legal_gate_wiring");
}

// Ban NC license markers in approved entries
for (const e of legal.entries || []) {
  if (!isApprovedStatus(e.status)) continue;
  const blob = JSON.stringify(e).toLowerCase();
  if (/\bcc[- ]?by[- ]?nc\b|non-commercial|nekomerční použití/.test(blob) && e.commercialUseAllowed === true) {
    // allow mention in notes only if commercialUseAllowed is false — already checked true
    if (/cc by-nc|cc-by-nc/.test(blob)) fail("approved_mentions_nc_license:" + e.sourceId);
  }
}

if (fails.length) {
  console.error("[iu-info-events-legal-whitelist-guard] FAIL");
  for (const f of fails.slice(0, 60)) console.error(" -", f);
  if (fails.length > 60) console.error(" - … +" + (fails.length - 60));
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
    (legal.nkodDiscovery || []).length
);
console.log("RESULT=PASS");
