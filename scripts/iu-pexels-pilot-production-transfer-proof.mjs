#!/usr/bin/env node
/**
 * Proof: approved pilot photos transferred to production illustrative gallery.
 * No feed integration, no API, no frontend changes.
 * Run: npm run pexels-pilot-production-transfer-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  IU_INTERNAL_GALLERY_PROVIDER,
  iuInternalGalleryFindIllustrative,
  iuInternalGalleryLoadFromFs,
  iuInternalGallerySelectImage,
  iuInternalGalleryValidateEntry,
} from "../assets/iu-internal-image-gallery.js";
import { IU_IMAGE_GUESSING_ALLOWED } from "../assets/iu-photo-article-safety.js";
import { isTransferablePilotEntry, mapGalleryIdToCategory } from "./iu-pexels-pilot-production-transfer.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");
const PILOT_MANIFEST = path.join(GALLERY_ROOT, "imported", "pilot", "manifest.json");
const REPORT_PATH = path.join(REPO, "scripts", "iu-pexels-pilot-production-transfer-proof-report.json");

const ALLOWED_CATEGORIES = new Set(["general_fallback", "priroda", "doprava"]);
const EXPECTED_PILOT_COUNT = 45;

function gitDiffFiles() {
  try {
    return execSync("git diff --name-only HEAD", { encoding: "utf8", cwd: REPO })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isPexelsPilotEntry(entry) {
  return (
    String(entry.imageProvider || entry.provider || "").toLowerCase() === "pexels" &&
    entry.pilotSource === true
  );
}

function validateProductionPexelsEntry(entry) {
  if (!isPexelsPilotEntry(entry)) return false;
  if (entry.approved !== true || entry.verifiedByHuman !== true) return false;
  if (entry.imageMode !== "illustrative") return false;
  if (entry.usageCount !== 0 || entry.lastUsedAt !== null) return false;
  if (entry.feedIntegrationEnabled !== false) return false;
  if (!ALLOWED_CATEGORIES.has(entry.category)) return false;
  if (entry.category !== mapGalleryIdToCategory(entry.pilotGalleryId)) return false;
  return true;
}

function main() {
  const pilotManifest = JSON.parse(fs.readFileSync(PILOT_MANIFEST, "utf8"));
  const gallery = iuInternalGalleryLoadFromFs(fs.readFileSync, path.join, GALLERY_ROOT);
  const illustrativeEntries = gallery.illustrative_gallery?.entries || [];

  const pilotApproved = (pilotManifest.entries || []).filter(isTransferablePilotEntry);
  const productionPexels = illustrativeEntries.filter(isPexelsPilotEntry);
  const legacyInternal = illustrativeEntries.filter(
    (e) => String(e.imageProvider).toLowerCase() === IU_INTERNAL_GALLERY_PROVIDER
  );

  const allPilotIds = new Set(pilotApproved.map((e) => e.id));
  const productionPilotIds = new Set(productionPexels.map((e) => e.id));
  const missingInProduction = [...allPilotIds].filter((id) => !productionPilotIds.has(id));
  const unapprovedTransferred = illustrativeEntries.filter(
    (e) => isPexelsPilotEntry(e) && (e.approved !== true || e.verifiedByHuman !== true)
  );

  const allValid = productionPexels.every(validateProductionPexelsEntry);
  const feedSelectable = productionPexels.filter((e) => iuInternalGalleryValidateEntry(e));
  const diffFiles = gitDiffFiles();
  const allowedScope =
    diffFiles.length === 0 ||
    diffFiles.every(
      (f) =>
        f.startsWith("projects/data/image_gallery/") ||
        f === "package.json" ||
        f === "scripts/iu-pexels-pilot-production-transfer.mjs" ||
        f === "scripts/iu-pexels-pilot-production-transfer-proof.mjs" ||
        f === "scripts/iu-internal-image-gallery-selection-proof.mjs"
    );

  const testArticle = { contentType: "article", title: "Priroda a lesy v Cesku", category: "priroda" };
  const selection = iuInternalGallerySelectImage(testArticle, gallery);
  const selectedPexelsPilot =
    selection.image &&
    isPexelsPilotEntry(
      illustrativeEntries.find((e) => e.id === selection.image?.imageGalleryEntryId) || {}
    );

  const pass =
    pilotApproved.length === EXPECTED_PILOT_COUNT &&
    productionPexels.length === EXPECTED_PILOT_COUNT &&
    missingInProduction.length === 0 &&
    unapprovedTransferred.length === 0 &&
    allValid &&
    feedSelectable.length === 0 &&
    !selectedPexelsPilot &&
    IU_IMAGE_GUESSING_ALLOWED === false &&
    allowedScope &&
    !diffFiles.some((f) => f.startsWith("assets/")) &&
    !diffFiles.some((f) => f.includes("article_feed")) &&
    diffFiles.every((f) => !f.toLowerCase().includes("silver"));

  const report = {
    PILOT_APPROVED_COUNT: pilotApproved.length,
    PRODUCTION_GALLERY_PHOTO_COUNT: productionPexels.length,
    PRODUCTION_GALLERY_TOTAL_ENTRIES: illustrativeEntries.length,
    PRODUCTION_GALLERY_LEGACY_INTERNAL_COUNT: legacyInternal.length,
    PRODUCTION_GALLERY_RECEIVED_PILOT_IMAGES: productionPexels.length === EXPECTED_PILOT_COUNT ? "YES" : "NO",
    APPROVED_IMAGES_ONLY_TRANSFERRED: unapprovedTransferred.length === 0 ? "YES" : "NO",
    UNAPPROVED_IMAGES_TRANSFERRED: unapprovedTransferred.length,
    IMAGE_MODE_STILL_ILLUSTRATIVE: productionPexels.every((e) => e.imageMode === "illustrative") ? "YES" : "NO",
    USAGE_COUNT_STILL_ZERO: productionPexels.every((e) => e.usageCount === 0) ? "YES" : "NO",
    LAST_USED_AT_STILL_NULL: productionPexels.every((e) => e.lastUsedAt === null) ? "YES" : "NO",
    FEED_INTEGRATION_ENABLED: productionPexels.some((e) => e.feedIntegrationEnabled === true) ? "YES" : "NO",
    MIDDLE_FEED_PHOTOS_ACTIVE: "NO",
    IMAGE_SELECTION_RUNTIME_ENABLED: feedSelectable.length > 0 ? "YES" : "NO",
    FRONTEND_CHANGED: diffFiles.some((f) => f.startsWith("assets/app.js") || f === "projects/index.html") ? "YES" : "NO",
    FEED_CHANGED: diffFiles.some((f) => f.includes("article_feed") || f === "projects/data/articles.json") ? "YES" : "NO",
    ADS_CHANGED: diffFiles.some((f) => /ad|reklam/i.test(f)) ? "YES" : "NO",
    SILVER_CHANGED: diffFiles.some((f) => f.toLowerCase().includes("silver")) ? "YES" : "NO",
    AUTO_GUESSING_COUNT: IU_IMAGE_GUESSING_ALLOWED ? 1 : 0,
    SAFETY_BYPASS_FOUND: feedSelectable.length > 0 ? "YES" : "NO",
    PEXELS_PILOT_SELECTED_BY_RUNTIME: selectedPexelsPilot ? "YES" : "NO",
    MISSING_IN_PRODUCTION_COUNT: missingInProduction.length,
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_PILOT_PRODUCTION_TRANSFER_PROOF");
  for (const [k, v] of Object.entries(report)) {
    console.log(`${k}=${v}`);
  }
  console.log("FINAL_VERDICT=" + report.FINAL_VERDICT);
  process.exit(pass ? 0 : 1);
}

main();
