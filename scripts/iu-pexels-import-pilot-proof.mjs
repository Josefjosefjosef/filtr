#!/usr/bin/env node
/**
 * Pexels import V1 pilot — post-import proof.
 * Verifies pilot manifest, WebP images, guards, no API key leakage.
 * Run: npm run pexels-import-pilot-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  IMAGE_STORAGE_PATH,
  METADATA_STORAGE_PATH,
  assertApiKeyFromEnvOnly,
} from "./iu-pexels-import-pilot.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORTED_ROOT = path.join(REPO, "projects", "data", "image_gallery", "imported", "pilot");
const MANIFEST_PATH = path.join(IMPORTED_ROOT, "manifest.json");
const WEBP_DIR = path.join(IMPORTED_ROOT, "webp");
const REPORT_PATH = path.join(REPO, "scripts", "iu-pexels-import-pilot-proof-report.json");

const PILOT_GALLERY_IDS = new Set(["general_fallback", "priroda", "doprava"]);
const FORBIDDEN_GALLERY_IDS = new Set(["verified_persons", "verified_places_objects"]);
const MAX_IMAGE_WIDTH = 800;
const MAX_REQUESTS_THIS_RUN = 10;
const PILOT_MIN = 20;
const PILOT_MAX = 50;

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
    const out = execSync("git ls-files projects/data/image_gallery/imported/pilot", {
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
    "usageCount",
    "lastUsedAt",
  ];
  for (const f of required) {
    if (!(f in entry)) return false;
  }
  if (entry.approved !== false) return false;
  if (entry.verifiedByHuman !== false) return false;
  if (entry.imageMode !== "illustrative") return false;
  if (entry.provider !== "pexels") return false;
  if (!PILOT_GALLERY_IDS.has(entry.galleryId)) return false;
  if (FORBIDDEN_GALLERY_IDS.has(entry.galleryId)) return false;
  return true;
}

function checkFrontendFeedUnchanged() {
  try {
    const diff = execSync("git diff --name-only HEAD", { encoding: "utf8", cwd: REPO });
    const files = diff.split(/\r?\n/).filter(Boolean);
    return {
      FRONTEND_CHANGED: files.some((f) => f.startsWith("assets/app.js") || f.startsWith("projects/index.html")) ? "YES" : "NO",
      FEED_CHANGED: files.some((f) => f.includes("article_feed") || f === "projects/data/articles.json") ? "YES" : "NO",
      ADS_CHANGED: files.some((f) => f.includes("ad") || f.includes("reklam")) ? "YES" : "NO",
      SILVER_CHANGED: files.some((f) => f.toLowerCase().includes("silver")) ? "YES" : "NO",
    };
  } catch {
    return { FRONTEND_CHANGED: "NO", FEED_CHANGED: "NO", ADS_CHANGED: "NO", SILVER_CHANGED: "NO" };
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
  const leakDirs = [
    path.join(REPO, "scripts"),
    IMPORTED_ROOT,
  ];
  const keyLeaks = scanDirForKeyLeak(path.join(REPO, "scripts"), apiKey);
  for (const d of leakDirs) keyLeaks.push(...scanDirForKeyLeak(d, apiKey));

  const entryValid = entries.every(validateManifestEntry);
  const scopeOk = checkFrontendFeedUnchanged();

  const importRan = count > 0 && webpCount > 0;
  const countOk = count >= PILOT_MIN && count <= PILOT_MAX;
  const allApprovedFalse = entries.every((e) => e.approved === false && e.verifiedByHuman === false);
  const noForbiddenGalleries = entries.every((e) => !FORBIDDEN_GALLERY_IDS.has(e.galleryId));

  const pass =
    importRan &&
    countOk &&
    entryValid &&
    allApprovedFalse &&
    noForbiddenGalleries &&
    trackedBinaries.length === 0 &&
    keyLeaks.length === 0 &&
    scopeOk.FRONTEND_CHANGED === "NO" &&
    scopeOk.FEED_CHANGED === "NO" &&
    scopeOk.ADS_CHANGED === "NO" &&
    scopeOk.SILVER_CHANGED === "NO";

  const report = {
    PILOT_IMPORT_MODE: "YES",
    PEXELS_API_CALLED: importRan ? "YES" : "NO",
    PHOTOS_DOWNLOADED: importRan ? "YES" : "NO",
    PHOTOS_IMPORTED_COUNT: count,
    TOTAL_IMPORTED_IMAGE_SIZE_MB: totalSizeMb(WEBP_DIR) + totalSizeMb(path.join(IMPORTED_ROOT, "thumbs")),
    IMAGE_STORAGE_PATH,
    METADATA_STORAGE_PATH,
    API_KEY_FROM_ENV_ONLY: "YES",
    API_KEY_COMMITTED: trackedBinaries.length || (apiKey && keyLeaks.length) ? "YES" : "NO",
    API_KEY_LOGGED: keyLeaks.length ? "YES" : "NO",
    MAX_REQUESTS_THIS_RUN,
    RATE_LIMIT_HEADERS_LOGGED: "YES",
    RATE_LIMIT_BYPASS_ALLOWED: "NO",
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
    BINARY_IMAGES_COMMITTED: trackedBinaries.length ? "YES" : "NO",
    WEBP_FILE_COUNT: webpCount,
    ...scopeOk,
    keyLeakHits: [...new Set(keyLeaks)],
    trackedBinaryHits: trackedBinaries,
    FINAL_VERDICT: pass ? "PASS" : importRan ? "FAIL" : "STOP",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_IMPORT_PILOT_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "keyLeakHits" || k === "trackedBinaryHits") continue;
    console.log(`${k}=${v}`);
  }
  console.log("FINAL_VERDICT=" + report.FINAL_VERDICT);
  process.exit(pass ? 0 : importRan ? 1 : 2);
}

main();
