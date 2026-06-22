#!/usr/bin/env node
/**
 * Transfer approved pilot Pexels photos into production illustrative_gallery.json.
 * No API calls, no downloads, no feed integration.
 * Run: npm run pexels-pilot-production-transfer
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PILOT_MANIFEST = path.join(REPO, "projects", "data", "image_gallery", "imported", "pilot", "manifest.json");
const ILLUSTRATIVE_PATH = path.join(REPO, "projects", "data", "image_gallery", "illustrative_gallery.json");

const GALLERY_TO_CATEGORY = {
  priroda: "priroda",
  doprava: "doprava",
  general_fallback: "general_fallback",
};

const URL_BASE = "https://infouzel.cz/internal-gallery/imported/pilot/";

export function mapGalleryIdToCategory(galleryId) {
  return GALLERY_TO_CATEGORY[galleryId] || "general_fallback";
}

export function pilotEntryToProduction(pilotEntry) {
  const webpFile = path.basename(pilotEntry.localImagePath || "");
  const thumbFile = path.basename(pilotEntry.localThumbPath || "");
  const reviewedAt = pilotEntry.manualReviewedAt || pilotEntry.downloadedAt;

  return {
    id: pilotEntry.id,
    type: "illustrative",
    category: mapGalleryIdToCategory(pilotEntry.galleryId),
    entityName: "",
    entityAliases: [],
    imageMode: "illustrative",
    imageProvider: "pexels",
    provider: "pexels",
    imageThumbUrl: URL_BASE + "thumbs/" + thumbFile,
    imageUrl: URL_BASE + "webp/" + webpFile,
    imageAlt: pilotEntry.imageAlt,
    imageAuthor: pilotEntry.imageAuthor,
    imageAuthorUrl: pilotEntry.imageAuthorUrl,
    imageSourceUrl: pilotEntry.imageSourceUrl,
    imageLicenseSource: pilotEntry.imageLicenseSource,
    verifiedByHuman: true,
    approved: true,
    createdAt: pilotEntry.downloadedAt,
    updatedAt: reviewedAt,
    usageCount: 0,
    lastUsedAt: null,
    pexelsId: pilotEntry.pexelsId,
    feedIntegrationEnabled: false,
    pilotSource: true,
    pilotGalleryId: pilotEntry.galleryId,
    localThumbPath: pilotEntry.localThumbPath,
    localImagePath: pilotEntry.localImagePath,
    manualReviewStatus: pilotEntry.manualReviewStatus,
    manualReviewedAt: pilotEntry.manualReviewedAt,
    manualReviewNote: pilotEntry.manualReviewNote,
  };
}

export function isTransferablePilotEntry(entry) {
  return entry.approved === true && entry.verifiedByHuman === true;
}

export function transferApprovedPilotToProduction({ dryRun = false } = {}) {
  const pilotManifest = JSON.parse(fs.readFileSync(PILOT_MANIFEST, "utf8"));
  const illustrative = JSON.parse(fs.readFileSync(ILLUSTRATIVE_PATH, "utf8"));
  const existingIds = new Set((illustrative.entries || []).map((e) => e.id));

  const approved = (pilotManifest.entries || []).filter(isTransferablePilotEntry);
  const unapproved = (pilotManifest.entries || []).filter((e) => !isTransferablePilotEntry(e));
  const toAdd = [];
  let skippedExisting = 0;

  for (const pilotEntry of approved) {
    if (existingIds.has(pilotEntry.id)) {
      skippedExisting += 1;
      continue;
    }
    toAdd.push(pilotEntryToProduction(pilotEntry));
  }

  if (!dryRun && toAdd.length) {
    illustrative.entries = [...(illustrative.entries || []), ...toAdd];
    illustrative.pilotPexelsProduction = {
      feedIntegrationEnabled: false,
      transferredAt: new Date().toISOString(),
      pilotApprovedCount: approved.length,
      productionPexelsCount: illustrative.entries.filter(
        (e) => String(e.imageProvider).toLowerCase() === "pexels"
      ).length,
    };
    fs.writeFileSync(ILLUSTRATIVE_PATH, JSON.stringify(illustrative, null, 2) + "\n", "utf8");
  }

  return {
    pilotApprovedCount: approved.length,
    unapprovedCount: unapproved.length,
    transferredCount: toAdd.length,
    skippedExisting,
    productionTotal: (illustrative.entries || []).length + (dryRun ? toAdd.length : 0),
    dryRun,
  };
}

function main() {
  const result = transferApprovedPilotToProduction();
  console.log("PEXELS_PILOT_PRODUCTION_TRANSFER");
  console.log("PILOT_APPROVED_COUNT=" + result.pilotApprovedCount);
  console.log("TRANSFERRED_COUNT=" + result.transferredCount);
  console.log("SKIPPED_EXISTING=" + result.skippedExisting);
  console.log("UNAPPROVED_SKIPPED=" + result.unapprovedCount);
  console.log("PRODUCTION_GALLERY_TOTAL=" + result.productionTotal);
  console.log("FEED_INTEGRATION_ENABLED=NO");
  console.log("FINAL_VERDICT=" + (result.transferredCount > 0 || result.skippedExisting > 0 ? "PASS" : "FAIL"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
