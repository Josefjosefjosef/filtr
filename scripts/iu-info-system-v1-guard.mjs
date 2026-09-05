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
mustExist("projects/data/info_events/legal_source_registry.json");
mustExist("scripts/iu-info-events-legal-registry-lib.mjs");
mustExist("docs/info-system-v1/12-legal-whitelist-audit.md");

const taxonomy = JSON.parse(fs.readFileSync(path.join(DIR, "taxonomy.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(DIR, "source_registry.json"), "utf8"));
const feed = JSON.parse(fs.readFileSync(path.join(DIR, "feed.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const metadata = JSON.parse(fs.readFileSync(path.join(DIR, "metadata.json"), "utf8"));

if (!Array.isArray(taxonomy.sections) || taxonomy.sections.length < 9) fails.push("taxonomy:sections");
if (!Array.isArray(registry.entries) || registry.entries.length < 20) fails.push("registry:entries");
if (!Array.isArray(feed.items) || feed.items.length < 5) fails.push("feed:items_min_5");
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
if (active.length < 1) fails.push("registry:active_min_1");

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
  const isChmi = String(it.sourceId || "") === "chmi" && it.capV2;
  if (isChmi) {
    const srcDoc = String((it.capV2 && it.capV2.sourceDocumentUrl) || "");
    const pub = String(it.publicUrl || (it.capV2 && it.capV2.publicUrl) || "");
    const publisher = String(it.publisherWebUrl || (it.capV2 && it.capV2.publisherWebUrl) || "");
    const can = canonicalizeUrl(it.canonicalUrl || srcDoc);
    if (!srcDoc || !isConcreteItemUrl(srcDoc, home)) {
      homepageHits += 1;
      fails.push(`chmi_missing_source_document:${it.id}`);
    }
    if (pub !== "https://vystrahy-cr.chmi.cz/") {
      fails.push(`chmi_public_url_not_unified:${it.id}:${pub || "MISSING"}`);
    }
    if (String(it.url || "") !== pub) {
      fails.push(`chmi_click_url_mismatch:${it.id}`);
    }
    if (/\.xml/i.test(String(it.url || ""))) {
      fails.push(`chmi_xml_as_public_click:${it.id}`);
    }
    if (publisher && !/^https:\/\//i.test(publisher)) {
      fails.push(`chmi_bad_publisher_web:${it.id}`);
    }
    if (can && /vystrahy-cr\.chmi\.cz\/?$/i.test(can)) {
      fails.push(`chmi_canonical_is_portal_homepage:${it.id}`);
    }
  } else if (!isConcreteItemUrl(url, home) || (original && !isConcreteItemUrl(original, home))) {
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
  fails.push("core:saved_views_storage_missing");
}
if (!/evaluateLocalAlerts|iu\.infoEvents\.alerts\.v1|pushServer/.test(core)) {
  fails.push("core:local_alerts_missing");
}
if (!/buildFeedIndex|memo|homeKraj|myRegionOnly/.test(core)) {
  fails.push("core:v4_perf_region_missing");
}
if (!/data-iu-ui=\"v6-clean\"|open-settings|settings-close|data-mode=\"hidden\"|unhide/.test(ui)) {
  fails.push("ui:v6_clean_shell_missing");
}
if (!/bannerHtml|data-iu-pd-banner|infouzel-prehled-dne-banner\.png/.test(ui)) {
  fails.push("ui:day_banner_missing");
}
if (!/iuPrehledDne__axis|iuPrehledDne__dot|iu-pd-dot/.test(ui)) {
  fails.push("ui:timeline_axis_missing");
}
if (/settings-save|Uložit nastavení|settings-cancel|Další instituce|label:\s*\"Kraje\"/.test(ui)) {
  fails.push("ui:settings_v6_regression_markers");
}
if (!/iuPdBtn--settings|persistDraft|activeSection|standaloneSources/.test(ui)) {
  fails.push("ui:settings_v6_autosave_structure_missing");
}
if (/data-view=|save-view|iuPrehledDneSheet|data-iu-ui=\"v5-slim\"|Hledat instituci|Moje uložené regiony|open-filters|open-more-topics/.test(ui)) {
  fails.push("ui:legacy_v5_chrome_still_present");
}
if (/Typ informací|Úroveň regionu|Oblíbené skupiny|id=\"iuPrehledDneSort\"|id=\"iuPrehledDneTime\"|Otevřít článek/.test(ui)) {
  fails.push("ui:removed_controls_still_present");
}
if (!/migrateLocalStateOnce|sanitizeUserPrefs|nejnovejsi|LS_SCHEMA_VERSION = 6|unhideItem|hiddenMode/.test(core)) {
  fails.push("core:v6_migration_unhide_missing");
}
if (!/iu\.infoEvents\.prefs\.v1/.test(core)) {
  fails.push("core:prefs_localstorage_key");
}

// Legal whitelist registry + publish gate contract
{
  const legalPath = path.join(DIR, "legal_source_registry.json");
  if (!fs.existsSync(legalPath)) {
    fails.push("missing:legal_source_registry");
  } else {
    const legal = JSON.parse(fs.readFileSync(legalPath, "utf8"));
    if (!legal.gate || legal.gate.enforceHard !== true) fails.push("legal:gate_enforceHard");
    const approved = new Set([
      "APPROVED_CC0",
      "APPROVED_CC_BY",
      "APPROVED_OPEN_DATA",
      "APPROVED_WITH_ATTRIBUTION",
      "APPROVED_WITH_SPECIFIC_CONDITIONS",
    ]);
    const byId = new Map((legal.entries || []).map((e) => [e.sourceId, e]));
    for (const e of registry.entries || []) {
      if (!(e.productionActive && e.productionApproved && e.legalStatus === "approved")) continue;
      const L = byId.get(e.id);
      if (!L) fails.push("legal:missing_entry:" + e.id);
      else if (!approved.has(L.status)) fails.push("legal:active_not_approved:" + e.id + ":" + L.status);
      else if (L.commercialUseAllowed !== true || L.adSupportedUseAllowed !== true || L.combinationAllowed !== true) {
        fails.push("legal:active_flags:" + e.id);
      }
    }
    for (const id of ["ct24", "irozhlas"]) {
      const e = (registry.entries || []).find((x) => x.id === id);
      if (e && e.productionActive) fails.push("legal:public_media_active:" + id);
    }
  }
  if (!/canPublishFromSource|loadLegalRegistry/.test(fs.readFileSync(path.join(REPO, "scripts/iu-info-events-refresh.mjs"), "utf8"))) {
    fails.push("refresh:legal_gate_missing");
  }
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
const v2src = fs.readFileSync(path.join(REPO, "scripts/iu-info-events-v2.mjs"), "utf8");
if (!/isInActiveFeedWindow|timeConfidence|neverRejuvenateByFirstSeen|buildDataQualityMetrics/.test(v2src)) {
  fails.push("v2:chrono_96h_quality_missing");
}
const libsrc = fs.readFileSync(path.join(REPO, "scripts/iu-info-events-lib.mjs"), "utf8");
if (!/parsePublishDateToIso|extractTitleLeadingDate|sourcePublications/.test(libsrc)) {
  fails.push("lib:publish_date_dedup_missing");
}
const refreshsrc = fs.readFileSync(path.join(REPO, "scripts/iu-info-events-refresh.mjs"), "utf8");
if (!/MAX_AGE_HOURS \|\| \"0\"|activeWindowHours|publikovano/.test(refreshsrc)) {
  fails.push("refresh:lifecycle_window_config_missing");
}
if (!/sourcePublications|Právě probíhá|další .* zdroje|Zobrazit všechny zdroje|iuPdCard__title|data-act=\"open-title\"/.test(ui)) {
  fails.push("ui:clean_meta_or_title_open_missing");
}

// Feed chronology / metadata quality (enforced after regeneration publishes dataQuality)
let fallback = 0;
let techTags = 0;
const TECH = /^(html|rss|atom|opendata|api|xml|json|html-list|none)$/i;
for (const it of feed.items || []) {
  if (String(it.timeConfidence || "") === "fallback" || !it.publishedAtSource) fallback += 1;
  for (const t of it.tags || []) if (TECH.test(String(t))) techTags += 1;
}
if (feed.dataQuality) {
  if (techTags > 0) fails.push("feed:tech_tags_in_user_tags:" + techTags);
  if (Array.isArray(feed.dataQuality.blockers) && feed.dataQuality.blockers.includes("tech_tags_in_user_fields")) {
    fails.push("monitoring:tech_tags_blocker");
  }
}
if (/Client-side 96h safety|96 \* 3600000/.test(core)) {
  fails.push("core:client_96h_safety_must_be_removed");
}
if (!/no fixed client publish-age window|lifecycle \/ future-publish/.test(core)) {
  fails.push("core:client_no_fixed_window_missing");
}
if (!fs.existsSync(path.join(REPO, "docs/info-system-v1/09-data-stabilization-evidence.json"))) {
  fails.push("docs:evidence_json_missing");
}
if (!fs.existsSync(path.join(REPO, "scripts/iu-info-events-data-stab-evidence-guard.mjs"))) {
  fails.push("scripts:evidence_guard_missing");
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
