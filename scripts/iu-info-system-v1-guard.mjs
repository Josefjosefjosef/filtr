#!/usr/bin/env node
/** Guard: InfoUzel info-system v2 integrity. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalizeUrl, isConcreteItemUrl } from "./iu-info-events-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "projects/data/info_events");
const fails = [];

function mustExist(rel) {
  if (!fs.existsSync(path.join(REPO, rel))) fails.push(`missing:${rel}`);
}

mustExist("projects/data/info_events/taxonomy.json");
mustExist("projects/data/info_events/source_registry.json");
mustExist("projects/data/info_events/feed.json");
mustExist("projects/data/info_events/cutover_state.json");
mustExist("projects/data/info_events/manifest.json");
mustExist("projects/data/info_events/metadata.json");
mustExist("assets/iu-info-system-core-v1.js");
mustExist("assets/iu-prehled-dne-ui-v1.js");
mustExist("assets/iu-prehled-dne-v1.css");
mustExist("scripts/iu-info-events-lib.mjs");
mustExist("scripts/iu-info-events-refresh.mjs");
mustExist("scripts/iu-info-events-v2.mjs");

const taxonomy = JSON.parse(fs.readFileSync(path.join(DIR, "taxonomy.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(DIR, "source_registry.json"), "utf8"));
const feed = JSON.parse(fs.readFileSync(path.join(DIR, "feed.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const metadata = JSON.parse(fs.readFileSync(path.join(DIR, "metadata.json"), "utf8"));

if (!Array.isArray(taxonomy.sections) || taxonomy.sections.length < 9) fails.push("taxonomy:sections");
if (!Array.isArray(registry.entries) || registry.entries.length < 20) fails.push("registry:entries");
if (!Array.isArray(feed.items) || feed.items.length < 50) fails.push("feed:items_min_50");
if (!manifest.generationId) fails.push("manifest:generationId");
if (!metadata.architecture || metadata.architecture.frontendMustNotFetchSourceSites !== true) {
  fails.push("metadata:frontendMustNotFetchSourceSites");
}
if (!metadata.personalization || !Array.isArray(metadata.personalization.filterDimensions)) {
  fails.push("metadata:personalization");
}
if ((metadata.personalization.filterDimensions || []).length < 12) {
  fails.push("metadata:personalization_dims_min_12");
}
if (!String(metadata.personalization.localStorageKey || "").includes("iu.infoEvents.prefs")) {
  fails.push("metadata:personalization_localStorageKey");
}
if (!String(metadata.personalization.viewsKey || "").includes("views")) {
  fails.push("metadata:viewsKey");
}
if (!metadata.personalization.localAlerts || metadata.personalization.localAlerts.pushServer !== false) {
  fails.push("metadata:localAlerts_no_push");
}
if (!Array.isArray(metadata.connectorGroups) || metadata.connectorGroups.length < 5) {
  fails.push("metadata:connectorGroups");
}

const active = (registry.entries || []).filter((e) => e.productionApproved && e.productionActive);
if (active.length < 15) fails.push("registry:active_min_15");

const STATUS_OK = new Set([
  "PRODUCTION_ACTIVE",
  "TECHNICALLY_BLOCKED",
  "LEGALLY_BLOCKED",
  "NO_STABLE_ITEM_SOURCE",
  "REQUIRES_MANUAL_LEGAL_REVIEW",
  "REJECTED",
]);

for (const e of registry.entries || []) {
  if (e.productionApproved && e.productionActive) {
    if (e.legalStatus !== "approved") fails.push(`legal:${e.id}`);
    if (!e.monitoring) fails.push(`monitoring:${e.id}`);
    if (!e.lane) fails.push(`lane_missing:${e.id}`);
    if (!e.connectorType) fails.push(`connectorType_missing:${e.id}`);
    const hasConnector = !!(
      e.feedUrl ||
      (e.feedUrls && e.feedUrls.length) ||
      e.htmlListUrl ||
      (e.htmlListUrls && e.htmlListUrls.length) ||
      e.capIndexUrl
    );
    if (!hasConnector) fails.push(`connector_missing:${e.id}`);
    if (e.connectorStatus && e.connectorStatus !== "PRODUCTION_ACTIVE") fails.push(`active_bad_status:${e.id}`);
  } else if (e.productionApproved === true && e.productionActive === false) {
    if (!STATUS_OK.has(String(e.connectorStatus || ""))) fails.push(`pending_status:${e.id}`);
    if (!e.blocker && !e.notes) fails.push(`pending_blocker:${e.id}`);
  }
}

// Lane files required by manifest
for (const lane of manifest.lanes || []) {
  const p = path.join(DIR, lane.path || `lanes/${lane.id}.json`);
  if (!fs.existsSync(p)) fails.push(`missing_lane:${lane.id}`);
}

const homeBySource = new Map((registry.entries || []).map((e) => [e.id, e.url]));
const banned = [/perex/i, /image/i, /thumbnail/i, /photo/i, /bodyHtml/i, /contentHtml/i];
let homepageHits = 0;
let missingChrono = 0;
const seenCanonical = new Map();
for (const it of feed.items || []) {
  for (const k of Object.keys(it)) {
    if (banned.some((re) => re.test(k))) fails.push(`banned_field:${it.id}:${k}`);
  }
  if (it.image || it.perex || it.body || it.thumbnail) fails.push(`content_leak:${it.id}`);
  const url = String(it.url || "");
  const original = String(it.originalUrl || it.url || "");
  if (!url) fails.push(`empty_url:${it.id}`);
  if (!/^https?:\/\//i.test(url)) fails.push(`bad_url:${it.id}`);
  if (original && !/^https?:\/\//i.test(original)) fails.push(`bad_original:${it.id}`);
  if (!it.sortAt || !it.firstSeenByInfoUzel || !it.lastProcessedAt) {
    missingChrono += 1;
    if (missingChrono <= 5) fails.push(`chrono_missing:${it.id}`);
  }
  const home = homeBySource.get(it.sourceId) || null;
  if (!isConcreteItemUrl(url, home) || (original && !isConcreteItemUrl(original, home))) {
    homepageHits += 1;
    fails.push(`homepage_or_listing_url:${it.id}`);
  }
  const can = canonicalizeUrl(it.canonicalUrl || url);
  if (can) {
    const prev = seenCanonical.get(can);
    if (prev && prev !== it.id) fails.push(`dup_canonical:${it.id}:${prev}`);
    else seenCanonical.set(can, it.id);
  }
}
if (homepageHits) fails.push(`homepage_urls_count:${homepageHits}`);
if (missingChrono) fails.push(`chrono_missing_count:${missingChrono}`);

if (!(registry.deactivatedCommercialMedia || []).length) fails.push("missing:deactivatedCommercialMedia");

const cutover = JSON.parse(fs.readFileSync(path.join(DIR, "cutover_state.json"), "utf8"));
if (cutover.commercialAggregationActive !== false) fails.push("cutover:commercialAggregationActive_must_be_false");
if (cutover.infoSystemActive !== true) fails.push("cutover:infoSystemActive_must_be_true");

// Frontend must not fetch source sites (static check)
const core = fs.readFileSync(path.join(REPO, "assets/iu-info-system-core-v1.js"), "utf8");
const ui = fs.readFileSync(path.join(REPO, "assets/iu-prehled-dne-ui-v1.js"), "utf8");
if (!/frontendMustNotFetchSourceSites|local-first|localFirst/i.test(core)) {
  fails.push("core:local_first_contract");
}
if (/fetch\(\s*['`]https?:\/\/(?!infouzel|josefjosefjosef\.github)/i.test(core)) {
  fails.push("core:forbidden_source_fetch_pattern");
}
if (!/favoriteSourceIds|favoriteLanes|favoriteRegions/.test(core)) {
  fails.push("core:favorites_prefs_missing");
}
if (!/timeRangeHours|activeOnly|newOnly|favoritesOnly/.test(core)) {
  fails.push("core:smart_filters_missing");
}
if (!/listViews|saveView|applyView|iu\.infoEvents\.views\.v1/.test(core)) {
  fails.push("core:saved_views_missing");
}
if (!/evaluateLocalAlerts|iu\.infoEvents\.alerts\.v1|pushServer/.test(core)) {
  fails.push("core:local_alerts_missing");
}
if (!/buildFeedIndex|memo|homeKraj|myRegionOnly/.test(core)) {
  fails.push("core:v4_perf_region_missing");
}
if (!/data-lane|data-org|data-fav-lane|iuPrehledDneTime/.test(ui)) {
  fails.push("ui:personalization_controls_missing");
}
if (!/data-view|save-view|iuPrehledDneHomeKraj|data-alert-rule|iuPrehledDneSearch/.test(ui)) {
  fails.push("ui:v4_views_alerts_missing");
}
if (!/iu\.infoEvents\.prefs\.v1/.test(core)) {
  fails.push("core:prefs_localstorage_key");
}

const monitoring = JSON.parse(fs.readFileSync(path.join(DIR, "monitoring.json"), "utf8"));
if (!monitoring.datasetAges || typeof monitoring.datasetAges.feedAgeHours !== "number") {
  fails.push("monitoring:datasetAges");
}
if (!Array.isArray(monitoring.alerts)) fails.push("monitoring:alerts");
if (!Array.isArray(monitoring.outageHistory)) fails.push("monitoring:outageHistory");
if (!/enrichMonitoringV3/.test(fs.readFileSync(path.join(REPO, "scripts/iu-info-events-v2.mjs"), "utf8"))) {
  fails.push("v2:enrichMonitoringV3_missing");
}

if (fails.length) {
  console.error("[iu-info-system-v1-guard] FAIL");
  for (const f of fails.slice(0, 50)) console.error(" -", f);
  if (fails.length > 50) console.error(" - … +" + (fails.length - 50));
  console.log("RESULT=FAIL");
  process.exit(1);
}
console.log(
  "[iu-info-system-v1-guard] OK v2 items=" +
    feed.items.length +
    " sources=" +
    registry.entries.length +
    " active=" +
    active.length +
    " generation=" +
    manifest.generationId
);
console.log("RESULT=PASS");
