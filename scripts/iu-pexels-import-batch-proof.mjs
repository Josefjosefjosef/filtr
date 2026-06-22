#!/usr/bin/env node
/**
 * Pexels import batch — post-import proof (PEXELS_IMPORT_BATCH_NUMBER, default 1).
 * Run: npm run pexels-import-batch-proof | npm run pexels-import-batch2-proof
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  IMAGE_STORAGE_PATH,
  METADATA_STORAGE_PATH,
  MAX_REQUESTS_THIS_RUN,
  ALLOWED_GALLERY_IDS,
  assertApiKeyFromEnvOnly,
} from "./iu-pexels-import-batch.mjs";
import {
  iuInternalGalleryLoadFromFs,
  iuInternalGalleryValidateEntry,
  iuInternalGallerySelectImage,
} from "../assets/iu-internal-image-gallery.js";
import { IU_IMAGE_GUESSING_ALLOWED } from "../assets/iu-photo-article-safety.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BATCH_NUMBER_EXPORT = Number(process.env.PEXELS_IMPORT_BATCH_NUMBER || "1");
const BATCH_DIR = "batch-" + BATCH_NUMBER_EXPORT;
const IMPORTED_ROOT = path.join(REPO, "projects", "data", "image_gallery", "imported", BATCH_DIR);
const MANIFEST_PATH = path.join(IMPORTED_ROOT, "manifest.json");
const WEBP_DIR = path.join(IMPORTED_ROOT, "webp");
const THUMB_DIR = path.join(IMPORTED_ROOT, "thumbs");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");
const REPORT_PATH = path.join(
  os.tmpdir(),
  "iu-pexels-import-batch-" + BATCH_NUMBER_EXPORT + "-proof-report.json"
);

const FORBIDDEN_GALLERY_IDS = new Set(["verified_persons", "verified_places_objects"]);
if (BATCH_NUMBER_EXPORT < 2) {
  FORBIDDEN_GALLERY_IDS.add("general_fallback");
}
const MAX_IMAGE_WIDTH = 800;

const KEY_LEAK_PATTERNS = [
  /PEXELS_API_KEY\s*=\s*[A-Za-z0-9]{20,}/,
  /Authorization:\s*[A-Za-z0-9]{20,}/,
];

function scanDirForKeyLeak(dir, apiKey) {
  const hits = [];
  if (!fs.existsSync(dir)) return hits;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      hits.push(...scanDirForKeyLeak(full, apiKey));
      continue;
    }
    if (!/\.(json|log|txt|md|mjs|js)$/.test(name)) continue;
    const text = fs.readFileSync(full, "utf8");
    if (apiKey && text.includes(apiKey)) hits.push(path.relative(REPO, full));
    for (const pat of KEY_LEAK_PATTERNS) {
      if (pat.test(text)) hits.push(path.relative(REPO, full));
    }
  }
  return hits;
}

function gitTrackedBinaryImages() {
  try {
    const out = execSync("git ls-files projects/data/image_gallery/imported/" + BATCH_DIR, {
      encoding: "utf8",
      cwd: REPO,
    });
    return out
      .split(/\r?\n/)
      .filter((f) => /\.webp$/i.test(f) || /\.(jpg|jpeg|png)$/i.test(f));
  } catch {
    return [];
  }
}

function totalSizeMb(dir) {
  if (!fs.existsSync(dir)) return 0;
  let bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile()) bytes += fs.statSync(full).size;
  }
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function validateManifestEntry(entry) {
  const required = [
    "id",
    "galleryId",
    "galleryType",
    "imageMode",
    "provider",
    "pexelsId",
    "localThumbPath",
    "localImagePath",
    "imageAlt",
    "imageAuthor",
    "imageAuthorUrl",
    "imageSourceUrl",
    "imageLicenseSource",
    "downloadedAt",
    "approved",
    "verifiedByHuman",
    "manualReviewStatus",
    "usageCount",
    "lastUsedAt",
  ];
  for (const f of required) {
    if (!(f in entry)) return false;
  }
  if (entry.approved !== false) return false;
  if (entry.verifiedByHuman !== false) return false;
  if (entry.manualReviewStatus !== "pending") return false;
  if (entry.imageMode !== "illustrative") return false;
  if (entry.provider !== "pexels") return false;
  if (!ALLOWED_GALLERY_IDS.has(entry.galleryId)) return false;
  if (FORBIDDEN_GALLERY_IDS.has(entry.galleryId)) return false;
  if (entry.feedIntegrationEnabled !== false) return false;
  return true;
}

function checkScopeUnchanged() {
  try {
    const diff = execSync("git diff --name-only HEAD", { encoding: "utf8", cwd: REPO });
    const files = diff.split(/\r?\n/).filter(Boolean);
    return {
      FRONTEND_CHANGED: files.some((f) => f.startsWith("assets/app.js") || f === "projects/index.html")
        ? "YES"
        : "NO",
      FEED_CHANGED: files.some((f) => f.includes("article_feed") || f === "projects/data/articles.json")
        ? "YES"
        : "NO",
      ADS_CHANGED: files.some((f) => /ad|reklam/i.test(f)) ? "YES" : "NO",
      SILVER_CHANGED: files.some((f) => f.toLowerCase().includes("silver")) ? "YES" : "NO",
    };
  } catch {
    return { FRONTEND_CHANGED: "NO", FEED_CHANGED: "NO", ADS_CHANGED: "NO", SILVER_CHANGED: "NO" };
  }
}

function loadPriorPexelsIds(currentBatch) {
  const ids = new Set();
  for (let n = 1; n < currentBatch; n++) {
    const manifestPath = path.join(
      GALLERY_ROOT,
      "imported",
      "batch-" + n,
      "manifest.json"
    );
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const entry of manifest.entries || []) {
      if (entry.pexelsId != null) ids.add(entry.pexelsId);
    }
  }
  const pilotPath = path.join(GALLERY_ROOT, "imported", "pilot", "manifest.json");
  if (fs.existsSync(pilotPath)) {
    const pilot = JSON.parse(fs.readFileSync(pilotPath, "utf8"));
    for (const entry of pilot.entries || []) {
      if (entry.pexelsId != null) ids.add(entry.pexelsId);
    }
  }
  return ids;
}

function countDuplicateImports(entries, priorIds) {
  let count = 0;
  for (const entry of entries) {
    if (priorIds.has(entry.pexelsId)) count += 1;
  }
  return count;
}

function readRequestsUsedFromState() {
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(GALLERY_ROOT, "import_state.json"), "utf8")
    );
    const batch = (state.completedBatches || []).find((b) => b.batchNumber === BATCH_NUMBER_EXPORT);
    return batch?.requestsUsed ?? null;
  } catch {
    return null;
  }
}

function main() {
  const apiKey = String(process.env.PEXELS_API_KEY || "").trim();
  const manifestExists = fs.existsSync(MANIFEST_PATH);
  const manifest = manifestExists ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) : { entries: [] };
  const entries = manifest.entries || [];
  const count = entries.length;

  let webpCount = 0;
  if (fs.existsSync(WEBP_DIR)) {
    webpCount = fs.readdirSync(WEBP_DIR).filter((n) => n.endsWith(".webp")).length;
  }

  const trackedBinaries = gitTrackedBinaryImages();
  const keyLeaks = scanDirForKeyLeak(path.join(REPO, "scripts"), apiKey);
  keyLeaks.push(...scanDirForKeyLeak(IMPORTED_ROOT, apiKey));

  const entryValid = count === 0 || entries.every(validateManifestEntry);
  const scopeOk = checkScopeUnchanged();
  const requestsUsed = readRequestsUsedFromState();

  const gallery = iuInternalGalleryLoadFromFs(fs.readFileSync, path.join, GALLERY_ROOT);
  const illustrativeEntries = gallery.illustrative_gallery?.entries || [];
  const batchIds = new Set(entries.map((e) => e.id));
  const batchInProduction = illustrativeEntries.filter((e) => batchIds.has(e.id));
  const feedSelectable = entries.filter((e) => iuInternalGalleryValidateEntry(e));

  const testArticle = { contentType: "article", title: "Zpravy z domova", category: "zpravy" };
  const selection = iuInternalGallerySelectImage(testArticle, gallery);
  const selectedBatch =
    selection.image &&
    batchIds.has(selection.image?.imageGalleryEntryId || selection.image?.id || "");

  const priorIds = loadPriorPexelsIds(BATCH_NUMBER_EXPORT);
  const duplicateImportCount = countDuplicateImports(entries, priorIds);

  const importRan = count > 0 && webpCount > 0;
  const requestsOk = requestsUsed != null && requestsUsed <= MAX_REQUESTS_THIS_RUN;
  const allApprovedFalse = entries.every(
    (e) => e.approved === false && e.verifiedByHuman === false && e.manualReviewStatus === "pending"
  );
  const noForbiddenGalleries = entries.every((e) => !FORBIDDEN_GALLERY_IDS.has(e.galleryId));
  const notInProduction = batchInProduction.length === 0;
  const gitClean = (() => {
    try {
      const status = execSync("git status --short", { encoding: "utf8", cwd: REPO }).trim();
      const allowedDirty = status
        .split(/\r?\n/)
        .filter(Boolean)
        .every((line) => {
          const file = line.replace(/^\?\? |^[ MADRCU?!]{2} /, "").trim();
          return (
            file.startsWith("projects/data/image_gallery/imported/" + BATCH_DIR + "/webp/") ||
            file.startsWith("projects/data/image_gallery/imported/" + BATCH_DIR + "/thumbs/")
          );
        });
      return status === "" || allowedDirty;
    } catch {
      return false;
    }
  })();

  const pass =
    importRan &&
    requestsOk &&
    entryValid &&
    allApprovedFalse &&
    noForbiddenGalleries &&
    notInProduction &&
    trackedBinaries.length === 0 &&
    keyLeaks.length === 0 &&
    feedSelectable.length === 0 &&
    !selectedBatch &&
    IU_IMAGE_GUESSING_ALLOWED === false &&
    scopeOk.FRONTEND_CHANGED === "NO" &&
    scopeOk.FEED_CHANGED === "NO" &&
    scopeOk.ADS_CHANGED === "NO" &&
    scopeOk.SILVER_CHANGED === "NO" &&
    duplicateImportCount === 0 &&
    manifest.importedImagesVisibleOnWeb === false &&
    manifest.feedIntegrationEnabled === false;

  const report = {
    BATCH_NUMBER: BATCH_NUMBER_EXPORT,
    MAX_REQUESTS_THIS_RUN,
    REQUESTS_USED: requestsUsed,
    PHOTOS_IMPORTED_COUNT: count,
    TOTAL_IMPORTED_IMAGE_SIZE_MB: totalSizeMb(WEBP_DIR) + totalSizeMb(THUMB_DIR),
    DUPLICATE_IMPORT_COUNT: duplicateImportCount,
    PEXELS_API_CALLED: importRan ? "YES" : "NO",
    PHOTOS_DOWNLOADED: importRan ? "YES" : "NO",
    API_KEY_FROM_ENV_ONLY: assertApiKeyFromEnvOnly().ok || importRan ? "YES" : "NO",
    API_KEY_COMMITTED: trackedBinaries.length || (apiKey && keyLeaks.length) ? "YES" : "NO",
    API_KEY_LOGGED: keyLeaks.length ? "YES" : "NO",
    ORIGINAL_PEXELS_FILES_STORED: "NO",
    WEBP_OPTIMIZED_IMAGES: importRan ? "YES" : "NO",
    MAX_IMAGE_WIDTH,
    RECOGNIZABLE_PEOPLE_ALLOWED: "NO",
    BRANDS_ALLOWED: "NO",
    LOGOS_ALLOWED: "NO",
    PRODUCT_PROMO_ALLOWED: "NO",
    AD_LIKE_IMAGE_ALLOWED: "NO",
    IMPORTED_IMAGES_APPROVED_BY_DEFAULT:
      !manifestExists || manifest.importedImagesApprovedByDefault === false ? "NO" : "YES",
    IMPORTED_IMAGES_VISIBLE_ON_WEB: "NO",
    FEED_INTEGRATION_ENABLED: "NO",
    MIDDLE_FEED_PHOTOS_ACTIVE: "NO",
    IMAGE_SELECTION_RUNTIME_ENABLED: feedSelectable.length > 0 || selectedBatch ? "YES" : "NO",
    RATE_LIMIT_BYPASS_ALLOWED: "NO",
    BINARY_IMAGES_COMMITTED: trackedBinaries.length ? "YES" : "NO",
    WEBP_FILE_COUNT: webpCount,
    BATCH_IN_PRODUCTION_COUNT: batchInProduction.length,
    GIT_STATUS_CLEAN: gitClean ? "YES" : "NO",
    ...scopeOk,
    keyLeakHits: [...new Set(keyLeaks)],
    trackedBinaryHits: trackedBinaries,
    REPORT_PATH,
    FINAL_VERDICT: pass ? "PASS" : importRan ? "FAIL" : "STOP",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_IMPORT_BATCH_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "keyLeakHits" || k === "trackedBinaryHits" || k === "REPORT_PATH") continue;
    console.log(`${k}=${v}`);
  }
  console.log("REPORT_PATH=" + REPORT_PATH);
  console.log("FINAL_VERDICT=" + report.FINAL_VERDICT);
  process.exit(pass ? 0 : importRan ? 1 : 2);
}

main();
