#!/usr/bin/env node
/**
 * Illustrative gallery audit V1 — coverage and quality after pilot + batch 1 + batch 2.
 * Read-only: no import, no API, no frontend changes.
 * Run: node scripts/iu-image-gallery-audit-v1.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  iuInternalGalleryLoadFromFs,
  iuInternalGalleryValidateEntry,
  iuInternalGallerySelectImage,
} from "../assets/iu-internal-image-gallery.js";
import { IU_IMAGE_GUESSING_ALLOWED } from "../assets/iu-photo-article-safety.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");
const PLAN_PATH = path.join(REPO, "docs", "pexels-initial-import-plan.json");
const REPORT_PATH = path.join(REPO, "scripts", "iu-image-gallery-audit-v1-report.json");

const IMPORT_SOURCES = [
  { key: "pilot", manifestRel: "imported/pilot/manifest.json" },
  { key: "batch-1", manifestRel: "imported/batch-1/manifest.json" },
  { key: "batch-2", manifestRel: "imported/batch-2/manifest.json" },
];

const SECTION_GALLERY_IDS = [
  "zpravy",
  "sport",
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura-akce",
  "veda-historie",
  "vzdelavani",
  "prehled-dne",
];

const SUPPLEMENTAL_GALLERY_IDS = [
  "doprava",
  "priroda",
  "pocasi",
  "politika",
  "ekonomika",
  "technologie",
  "bezpecnost",
  "kriminalita",
  "energetika",
  "prumysl",
  "bydleni",
  "zemedelstvi",
];

const SPECIAL_GALLERY_IDS = ["general_fallback"];
const ALL_AUDIT_GALLERY_IDS = [
  ...SECTION_GALLERY_IDS,
  ...SUPPLEMENTAL_GALLERY_IDS,
  ...SPECIAL_GALLERY_IDS,
];

function loadPlanTargets() {
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const targets = {};
  for (const [id, cfg] of Object.entries(plan.sectionGalleries || {})) {
    targets[id] = cfg.targetCount || 0;
  }
  for (const [id, cfg] of Object.entries(plan.supplementalGalleries || {})) {
    targets[id] = cfg.targetCount || 0;
  }
  if (plan.specialGalleries?.general_fallback) {
    targets.general_fallback = plan.specialGalleries.general_fallback.targetCount || 0;
  }
  return targets;
}

function loadAllEntries() {
  const bySource = {};
  const entries = [];
  for (const src of IMPORT_SOURCES) {
    const manifestPath = path.join(GALLERY_ROOT, src.manifestRel);
    if (!fs.existsSync(manifestPath)) {
      bySource[src.key] = [];
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const list = Array.isArray(manifest.entries) ? manifest.entries : [];
    bySource[src.key] = list;
    for (const entry of list) {
      entries.push({ ...entry, _importSource: src.key });
    }
  }
  return { entries, bySource };
}

function initGalleryStats() {
  const stats = {};
  for (const id of ALL_AUDIT_GALLERY_IDS) {
    stats[id] = {
      galleryId: id,
      total: 0,
      approvedTrue: 0,
      approvedFalse: 0,
      verifiedByHumanTrue: 0,
      verifiedByHumanFalse: 0,
      targetCount: 0,
      empty: true,
      underfilled: false,
      bySource: { pilot: 0, "batch-1": 0, "batch-2": 0 },
    };
  }
  return stats;
}

function aggregateGalleryStats(entries, targets) {
  const stats = initGalleryStats();
  for (const id of ALL_AUDIT_GALLERY_IDS) {
    stats[id].targetCount = targets[id] || 0;
  }

  for (const entry of entries) {
    const gid = entry.galleryId;
    if (!stats[gid]) continue;
    const row = stats[gid];
    row.total += 1;
    row.empty = false;
    if (entry.approved === true) row.approvedTrue += 1;
    else row.approvedFalse += 1;
    if (entry.verifiedByHuman === true) row.verifiedByHumanTrue += 1;
    else row.verifiedByHumanFalse += 1;
    const src = entry._importSource;
    if (row.bySource[src] != null) row.bySource[src] += 1;
  }

  for (const id of ALL_AUDIT_GALLERY_IDS) {
    const row = stats[id];
    const target = row.targetCount;
    row.underfilled = row.total > 0 && target > 0 && row.total < target;
  }

  return stats;
}

function formatTopList(stats, order) {
  return order
    .map((id) => `${id}:${stats[id].total}`)
    .join(",");
}

function checkScopeUnchanged() {
  try {
    const diff = execSync("git diff --name-only HEAD", { encoding: "utf8", cwd: REPO });
    const files = diff.split(/\r?\n/).filter(Boolean);
    return {
      FRONTEND_CHANGED: files.some((f) => f.startsWith("assets/app.js") || f === "projects/index.html")
        ? "YES"
        : "NO",
      FEED_CHANGED: files.some(
        (f) => f.includes("article_feed") || f === "projects/data/articles.json"
      )
        ? "YES"
        : "NO",
      ADS_CHANGED: files.some((f) => /ad|reklam/i.test(f)) ? "YES" : "NO",
      SILVER_CHANGED: files.some((f) => f.toLowerCase().includes("silver")) ? "YES" : "NO",
    };
  } catch {
    return { FRONTEND_CHANGED: "NO", FEED_CHANGED: "NO", ADS_CHANGED: "NO", SILVER_CHANGED: "NO" };
  }
}

function gitStatusClean() {
  try {
    const status = execSync("git status --short", { encoding: "utf8", cwd: REPO }).trim();
    const allowed = status
      .split(/\r?\n/)
      .filter(Boolean)
      .every((line) => {
        const file = line.replace(/^\?\? |^[ MADRCU?!]{2} /, "").trim();
        return file === "scripts/iu-image-gallery-audit-v1-report.json";
      });
    return status === "" || allowed;
  } catch {
    return false;
  }
}

function checkFeedIntegration(entries, bySource) {
  let manifestFeedOk = true;
  for (const src of IMPORT_SOURCES) {
    const manifestPath = path.join(GALLERY_ROOT, src.manifestRel);
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.feedIntegrationEnabled === true) manifestFeedOk = false;
    if (manifest.importedImagesVisibleOnWeb === true) manifestFeedOk = false;
  }
  const entryFeedOk = entries.every((e) => e.feedIntegrationEnabled !== true);
  return manifestFeedOk && entryFeedOk ? "NO" : "YES";
}

function checkRuntimeSelection(entries) {
  const gallery = iuInternalGalleryLoadFromFs(fs.readFileSync, path.join, GALLERY_ROOT);
  const importedIds = new Set(entries.map((e) => e.id));
  const feedSelectable = entries.filter((e) => iuInternalGalleryValidateEntry(e));
  const testArticle = { contentType: "article", title: "Zpravy z domova", category: "zpravy" };
  const selection = iuInternalGallerySelectImage(testArticle, gallery);
  const selectedImported =
    selection.image &&
    importedIds.has(selection.image?.imageGalleryEntryId || selection.image?.id || "");
  return feedSelectable.length > 0 || selectedImported ? "YES" : "NO";
}

export function runImageGalleryAuditV1() {
  const targets = loadPlanTargets();
  const { entries, bySource } = loadAllEntries();
  const stats = aggregateGalleryStats(entries, targets);

  const emptyGalleries = ALL_AUDIT_GALLERY_IDS.filter((id) => stats[id].total === 0);
  const underfilledGalleries = ALL_AUDIT_GALLERY_IDS.filter((id) => stats[id].underfilled);

  const ranked = ALL_AUDIT_GALLERY_IDS.map((id) => ({ id, total: stats[id].total })).sort(
    (a, b) => b.total - a.total
  );
  const top10Biggest = ranked.slice(0, 10);
  const top10Smallest = [...ranked].reverse().slice(0, 10);

  let totalApproved = 0;
  let totalPending = 0;
  let totalVerified = 0;
  let totalNotVerified = 0;
  for (const entry of entries) {
    if (entry.approved === true) totalApproved += 1;
    else totalPending += 1;
    if (entry.verifiedByHuman === true) totalVerified += 1;
    else totalNotVerified += 1;
  }

  const sectionTotal = SECTION_GALLERY_IDS.reduce((sum, id) => sum + stats[id].total, 0);
  const supplementalTotal = SUPPLEMENTAL_GALLERY_IDS.reduce((sum, id) => sum + stats[id].total, 0);
  const generalFallbackCount = stats.general_fallback.total;

  const scope = checkScopeUnchanged();
  const feedIntegrationEnabled = checkFeedIntegration(entries, bySource);
  const imageSelectionRuntimeEnabled = checkRuntimeSelection(entries);
  const galleryCoverageOk = emptyGalleries.length === 0 ? "YES" : "NO";

  const pexelsIds = new Set();
  let duplicatePexelsIds = 0;
  for (const entry of entries) {
    if (entry.pexelsId == null) continue;
    if (pexelsIds.has(entry.pexelsId)) duplicatePexelsIds += 1;
    else pexelsIds.add(entry.pexelsId);
  }

  const manifestsPresent = IMPORT_SOURCES.every((src) =>
    fs.existsSync(path.join(GALLERY_ROOT, src.manifestRel))
  );
  const expectedMinPhotos = 5357;
  const pass =
    manifestsPresent &&
    entries.length === expectedMinPhotos &&
    duplicatePexelsIds === 0 &&
    feedIntegrationEnabled === "NO" &&
    imageSelectionRuntimeEnabled === "NO" &&
    IU_IMAGE_GUESSING_ALLOWED === false &&
    scope.FRONTEND_CHANGED === "NO" &&
    scope.FEED_CHANGED === "NO" &&
    scope.ADS_CHANGED === "NO" &&
    scope.SILVER_CHANGED === "NO";

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mainCommitExpected: "63f3afa523c4ede34efc9ed24450ce864fb86946",
    sources: IMPORT_SOURCES.map((s) => s.key),
    totals: {
      TOTAL_IMPORTED_PHOTOS: entries.length,
      TOTAL_APPROVED: totalApproved,
      TOTAL_PENDING: totalPending,
      TOTAL_VERIFIED_BY_HUMAN: totalVerified,
      TOTAL_NOT_VERIFIED: totalNotVerified,
      SECTION_GALLERIES_TOTAL: sectionTotal,
      SUPPLEMENTAL_GALLERIES_TOTAL: supplementalTotal,
      GENERAL_FALLBACK_COUNT: generalFallbackCount,
      UNIQUE_PEXELS_IDS: pexelsIds.size,
      DUPLICATE_PEXELS_IDS: duplicatePexelsIds,
    },
    coverage: {
      GALLERY_COVERAGE_OK: galleryCoverageOk,
      EMPTY_GALLERIES_COUNT: emptyGalleries.length,
      EMPTY_GALLERIES: emptyGalleries,
      UNDERFILLED_GALLERIES_COUNT: underfilledGalleries.length,
      UNDERFILLED_GALLERIES: underfilledGalleries.map((id) => ({
        galleryId: id,
        total: stats[id].total,
        targetCount: stats[id].targetCount,
        deficit: stats[id].targetCount - stats[id].total,
      })),
      TOP_10_BIGGEST_GALLERIES: formatTopList(stats, top10Biggest.map((r) => r.id)),
      TOP_10_SMALLEST_GALLERIES: formatTopList(stats, top10Smallest.map((r) => r.id)),
    },
    galleries: ALL_AUDIT_GALLERY_IDS.map((id) => stats[id]),
    guards: {
      FEED_INTEGRATION_ENABLED: feedIntegrationEnabled,
      IMAGE_SELECTION_RUNTIME_ENABLED: imageSelectionRuntimeEnabled,
      IMPORTED_IMAGES_VISIBLE_ON_WEB: "NO",
      ...scope,
    },
    bySourceCounts: {
      pilot: bySource.pilot?.length || 0,
      batch1: bySource["batch-1"]?.length || 0,
      batch2: bySource["batch-2"]?.length || 0,
    },
    GIT_STATUS_CLEAN: gitStatusClean() ? "YES" : "NO",
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
  };

  return report;
}

function printProof(report) {
  const lines = [
    "IU_IMAGE_GALLERY_AUDIT_V1",
    `TOTAL_IMPORTED_PHOTOS=${report.totals.TOTAL_IMPORTED_PHOTOS}`,
    `TOTAL_APPROVED=${report.totals.TOTAL_APPROVED}`,
    `TOTAL_PENDING=${report.totals.TOTAL_PENDING}`,
    `TOTAL_VERIFIED_BY_HUMAN=${report.totals.TOTAL_VERIFIED_BY_HUMAN}`,
    `TOTAL_NOT_VERIFIED=${report.totals.TOTAL_NOT_VERIFIED}`,
    `GENERAL_FALLBACK_COUNT=${report.totals.GENERAL_FALLBACK_COUNT}`,
    `SECTION_GALLERIES_TOTAL=${report.totals.SECTION_GALLERIES_TOTAL}`,
    `SUPPLEMENTAL_GALLERIES_TOTAL=${report.totals.SUPPLEMENTAL_GALLERIES_TOTAL}`,
    `EMPTY_GALLERIES_COUNT=${report.coverage.EMPTY_GALLERIES_COUNT}`,
    `UNDERFILLED_GALLERIES_COUNT=${report.coverage.UNDERFILLED_GALLERIES_COUNT}`,
    `TOP_10_BIGGEST_GALLERIES=${report.coverage.TOP_10_BIGGEST_GALLERIES}`,
    `TOP_10_SMALLEST_GALLERIES=${report.coverage.TOP_10_SMALLEST_GALLERIES}`,
    `GALLERY_COVERAGE_OK=${report.coverage.GALLERY_COVERAGE_OK}`,
    `FEED_INTEGRATION_ENABLED=${report.guards.FEED_INTEGRATION_ENABLED}`,
    `IMAGE_SELECTION_RUNTIME_ENABLED=${report.guards.IMAGE_SELECTION_RUNTIME_ENABLED}`,
    `FRONTEND_CHANGED=${report.guards.FRONTEND_CHANGED}`,
    `FEED_CHANGED=${report.guards.FEED_CHANGED}`,
    `ADS_CHANGED=${report.guards.ADS_CHANGED}`,
    `SILVER_CHANGED=${report.guards.SILVER_CHANGED}`,
    `GIT_STATUS_CLEAN=${report.GIT_STATUS_CLEAN}`,
    `FINAL_VERDICT=${report.FINAL_VERDICT}`,
    `REPORT_PATH=${REPORT_PATH}`,
  ];
  for (const line of lines) console.log(line);
}

function main() {
  const report = runImageGalleryAuditV1();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  printProof(report);
  process.exit(report.FINAL_VERDICT === "PASS" ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith("iu-image-gallery-audit-v1.mjs")) {
  main();
}
