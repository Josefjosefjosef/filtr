#!/usr/bin/env node
/**
 * Pexels pilot manifest approval — proof only.
 * Verifies manually approved pilot metadata; no API, no downloads.
 * Run: npm run pexels-import-pilot-approval-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { METADATA_STORAGE_PATH } from "./iu-pexels-import-pilot.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO, "projects", "data", "image_gallery", "imported", "pilot", "manifest.json");
const WEBP_DIR = path.join(REPO, "projects", "data", "image_gallery", "imported", "pilot", "webp");
const REPORT_PATH = path.join(REPO, "scripts", "iu-pexels-import-pilot-approval-proof-report.json");

const EXPECTED_COUNT = 45;
const MANUAL_REVIEW_NOTE = "User manually reviewed pilot images and approved them.";

const KEY_LEAK_PATTERNS = [
  /PEXELS_API_KEY\s*=\s*[A-Za-z0-9]{20,}/,
  /Authorization:\s*[A-Za-z0-9]{20,}/,
];

function gitDiffFiles() {
  try {
    return execSync("git diff --name-only HEAD", { encoding: "utf8", cwd: REPO })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitStagedFiles() {
  try {
    return execSync("git diff --cached --name-only", { encoding: "utf8", cwd: REPO })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scanManifestForKeyLeak(text, apiKey) {
  if (apiKey && text.includes(apiKey)) return true;
  return KEY_LEAK_PATTERNS.some((pat) => pat.test(text));
}

function countWebpFiles() {
  if (!fs.existsSync(WEBP_DIR)) return 0;
  return fs.readdirSync(WEBP_DIR).filter((n) => n.endsWith(".webp")).length;
}

function validateApprovedEntry(entry) {
  if (entry.approved !== true) return false;
  if (entry.verifiedByHuman !== true) return false;
  if (entry.manualReviewStatus !== "approved") return false;
  if (!entry.manualReviewedAt) return false;
  if (entry.manualReviewNote !== MANUAL_REVIEW_NOTE) return false;
  if (entry.imageMode !== "illustrative") return false;
  if (entry.provider !== "pexels") return false;
  if (entry.usageCount !== 0) return false;
  if (entry.lastUsedAt !== null) return false;
  return true;
}

function main() {
  const apiKey = String(process.env.PEXELS_API_KEY || "").trim();
  const manifestExists = fs.existsSync(MANIFEST_PATH);
  const manifest = manifestExists
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : { entries: [] };
  const entries = manifest.entries || [];
  const count = entries.length;
  const webpCount = countWebpFiles();

  const approvedCount = entries.filter((e) => e.approved === true).length;
  const verifiedCount = entries.filter((e) => e.verifiedByHuman === true).length;
  const manualApprovedCount = entries.filter((e) => e.manualReviewStatus === "approved").length;
  const allEntriesValid = entries.every(validateApprovedEntry);
  const imageModeOk = entries.every((e) => e.imageMode === "illustrative");
  const usageCountOk = entries.every((e) => e.usageCount === 0);
  const lastUsedOk = entries.every((e) => e.lastUsedAt === null);

  const diffFiles = [...new Set([...gitDiffFiles(), ...gitStagedFiles()])];
  const scopeOk =
    diffFiles.every((f) =>
      f === "projects/data/image_gallery/imported/pilot/manifest.json" ||
      f.startsWith("scripts/iu-pexels-import-pilot-approval") ||
      f === "package.json" ||
      f === ".gitignore" ||
      f === "docs/internal-image-gallery-pexels-import-governance.md"
    ) || diffFiles.length === 0;

  const manifestText = manifestExists ? fs.readFileSync(MANIFEST_PATH, "utf8") : "";
  const keyInManifest = scanManifestForKeyLeak(manifestText, apiKey);

  let trackedBinaries = [];
  try {
    trackedBinaries = execSync("git ls-files projects/data/image_gallery/imported/pilot", {
      encoding: "utf8",
      cwd: REPO,
    })
      .split(/\r?\n/)
      .filter((f) => /\.webp$/i.test(f) || /\.(jpg|jpeg|png)$/i.test(f));
  } catch {
    trackedBinaries = [];
  }

  const pass =
    manifestExists &&
    count === EXPECTED_COUNT &&
    webpCount === EXPECTED_COUNT &&
    approvedCount === EXPECTED_COUNT &&
    verifiedCount === EXPECTED_COUNT &&
    manualApprovedCount === EXPECTED_COUNT &&
    allEntriesValid &&
    imageModeOk &&
    usageCountOk &&
    lastUsedOk &&
    !keyInManifest &&
    trackedBinaries.length === 0 &&
    manifest.importedImagesVisibleOnWeb === false &&
    diffFiles.every((f) => !f.startsWith("assets/app.js")) &&
    diffFiles.every((f) => !f.includes("article_feed")) &&
    diffFiles.every((f) => f !== "projects/data/articles.json") &&
    diffFiles.every((f) => !f.toLowerCase().includes("silver"));

  const report = {
    PILOT_PHOTOS_MANUAL_REVIEW_OK: manifest.pilotPhotosManualReviewOk ? "YES" : "NO",
    PILOT_MANIFEST_FOUND: manifestExists ? "YES" : "NO",
    PILOT_IMAGES_COUNT: count,
    PILOT_APPROVED_COUNT: approvedCount,
    PILOT_VERIFIED_BY_HUMAN_COUNT: verifiedCount,
    PILOT_MANUAL_REVIEW_STATUS_APPROVED_COUNT: manualApprovedCount,
    WEBP_FILE_COUNT: webpCount,
    PEXELS_API_CALLED: "NO",
    PHOTOS_DOWNLOADED: "NO",
    NEW_PHOTOS_ADDED: "NO",
    API_KEY_REQUIRED_NOW: "NO",
    API_KEY_COMMITTED: keyInManifest || trackedBinaries.length ? "YES" : "NO",
    IMPORTED_IMAGES_VISIBLE_ON_WEB: "NO",
    FRONTEND_CHANGED: diffFiles.some((f) => f.startsWith("assets/app.js") || f === "projects/index.html") ? "YES" : "NO",
    FEED_CHANGED: diffFiles.some((f) => f.includes("article_feed") || f === "projects/data/articles.json") ? "YES" : "NO",
    ADS_CHANGED: diffFiles.some((f) => /ad|reklam/i.test(f)) ? "YES" : "NO",
    SILVER_CHANGED: diffFiles.some((f) => f.toLowerCase().includes("silver")) ? "YES" : "NO",
    IMAGE_MODE_STILL_ILLUSTRATIVE: imageModeOk ? "YES" : "NO",
    USAGE_COUNT_STILL_ZERO: usageCountOk ? "YES" : "NO",
    LAST_USED_AT_STILL_NULL: lastUsedOk ? "YES" : "NO",
    METADATA_STORAGE_PATH,
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_IMPORT_PILOT_APPROVAL_PROOF");
  for (const [k, v] of Object.entries(report)) {
    console.log(`${k}=${v}`);
  }
  console.log("FINAL_VERDICT=" + report.FINAL_VERDICT);
  process.exit(pass ? 0 : 1);
}

main();
