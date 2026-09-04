#!/usr/bin/env node
/**
 * Guard: Zdroje a licence public registry contract.
 * - Absolute public JSON path (no relative ../data after root publish)
 * - Public allowlist / no secrets
 * - Active production connectors ⊆ approved public sources
 * - Snapshot embed present
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertPublicSafe,
  buildPublicRegistry,
  FORBIDDEN_PUBLIC_KEYS,
  PUBLIC_SOURCE_KEYS,
  writePublicRegistryArtifacts,
} from "./iu-legal-registry-public-build.mjs";
import { loadLegalRegistry, loadSourceRegistry, isApprovedStatus } from "./iu-info-events-legal-registry-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function fail(m) {
  fails.push(m);
}

const page = fs.readFileSync(path.join(REPO, "projects/zdroje-a-licence/index.html"), "utf8");
const publicPath = path.join(REPO, "projects/data/info_events/legal_source_registry.public.json");
const legal = loadLegalRegistry(REPO);
const sources = loadSourceRegistry(REPO);

if (!/REGISTRY_URL\s*=\s*"\/projects\/data\/info_events\/legal_source_registry\.public\.json"/.test(page)) {
  fail("page:must_fetch_absolute_public_json");
}
if (/\.\.\/data\/info_events\/legal_source_registry\.json/.test(page)) {
  fail("page:must_not_use_broken_relative_full_registry");
}
if (!/iuLegalRegistrySnapshot/.test(page)) fail("page:missing_snapshot_embed");
if (!/Aktuální kontrolu registru se nepodařilo načíst/.test(page)) {
  fail("page:missing_fallback_copy");
}
if (!/Související datové služby UI/.test(page)) fail("page:missing_related_ui_section");

if (!fs.existsSync(publicPath)) fail("missing:legal_source_registry.public.json");

let pub;
try {
  pub = JSON.parse(fs.readFileSync(publicPath, "utf8"));
  assertPublicSafe(pub);
} catch (e) {
  fail("public_json:" + (e && e.message ? e.message : e));
  pub = { sources: [], relatedUiSources: [] };
}

if (Number(pub.version) !== 1) fail("public:version_must_be_1");
if (!Array.isArray(pub.sources)) fail("public:sources_array");
if (!pub.sources.length) fail("public:active_sources_empty_but_connectors_exist");

const rebuilt = buildPublicRegistry(legal);
assertPublicSafe(rebuilt);
if (rebuilt.sources.length !== pub.sources.length) {
  fail("public:stale_run_iu-legal-registry-public-build");
}

const activeIds = new Set(
  (sources.entries || []).filter((e) => e && e.productionActive === true).map((e) => e.id)
);
for (const id of activeIds) {
  const legalE = (legal.entries || []).find((x) => x && x.sourceId === id);
  if (!legalE || !legalE.productionSourceActive || !isApprovedStatus(legalE.status)) {
    fail("active_connector_missing_approved_legal:" + id);
  }
  if (!(pub.sources || []).some((s) => s.sourceId === id)) {
    fail("active_connector_missing_from_public:" + id);
  }
}

for (const s of pub.sources || []) {
  if (!s.name || !s.purpose || !s.category || !s.status) fail("public_source_missing_core:" + (s.id || "?"));
  if (!s.officialUrl || !/^https:\/\//i.test(s.officialUrl)) fail("public_source_bad_officialUrl:" + (s.id || "?"));
  if (!s.licenseUrl || !/^https:\/\//i.test(s.licenseUrl)) fail("public_source_bad_licenseUrl:" + (s.id || "?"));
  if (!s.lastVerified || !/^\d{4}-\d{2}-\d{2}$/.test(s.lastVerified)) {
    fail("public_source_bad_lastVerified:" + (s.id || "?"));
  }
  for (const u of [s.officialUrl, s.licenseUrl, s.termsUrl].filter(Boolean)) {
    if (/localhost|127\.0\.0\.1|\.pages\.dev|workers\.dev|staging|internal/i.test(u)) {
      fail("public_source_forbidden_host:" + u);
    }
  }
}

const related = pub.relatedUiSources || [];
if (!related.some((r) => r.sourceId === "open-meteo")) fail("related:missing_open_meteo_honest_entry");
const om = related.find((r) => r.sourceId === "open-meteo");
if (om && om.status !== "VERIFICATION_REQUIRED") fail("related:open_meteo_must_not_fake_approved");

const snapMatch = page.match(
  /<script type="application\/json" id="iuLegalRegistrySnapshot">([\s\S]*?)<\/script>/
);
if (!snapMatch) fail("page:snapshot_script_missing");
else {
  try {
    const snap = JSON.parse(snapMatch[1]);
    assertPublicSafe(snap);
    if (!Array.isArray(snap.sources) || snap.sources.length < 1) fail("page:snapshot_empty");
  } catch (e) {
    fail("page:snapshot_invalid:" + (e && e.message ? e.message : e));
  }
}

const blob = JSON.stringify(pub);
for (const bad of FORBIDDEN_PUBLIC_KEYS) {
  if (new RegExp('"' + bad + '"\\s*:', "i").test(blob)) fail("leak:" + bad);
}
for (const k of PUBLIC_SOURCE_KEYS) {
  /* allowlist documented */
  void k;
}

// Ensure build script is the sync path (idempotent rewrite check)
writePublicRegistryArtifacts(REPO);

if (fails.length) {
  console.error("[iu-zdroje-licence-registry-guard] FAIL");
  fails.forEach((f) => console.error(" - " + f));
  process.exit(1);
}
console.log(
  "[iu-zdroje-licence-registry-guard] OK sources=" +
    pub.sources.length +
    " relatedUi=" +
    related.length
);
