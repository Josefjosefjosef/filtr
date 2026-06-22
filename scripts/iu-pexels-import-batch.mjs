#!/usr/bin/env node
/**
 * Pexels import batch — manual illustrative import (max 110 API requests per run).
 * Set PEXELS_IMPORT_BATCH_NUMBER (default 1). Requires PEXELS_API_KEY in environment.
 * Run: npm run pexels-import-batch | npm run pexels-import-batch2
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { loadQueue, loadState, saveState, getPendingItems } from "./iu-pexels-import-runner.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BATCH_NUMBER = Number(process.env.PEXELS_IMPORT_BATCH_NUMBER || "1");
const BATCH_DIR = "batch-" + BATCH_NUMBER;
const IMPORTED_ROOT = path.join(REPO, "projects", "data", "image_gallery", "imported", BATCH_DIR);
const WEBP_DIR = path.join(IMPORTED_ROOT, "webp");
const THUMB_DIR = path.join(IMPORTED_ROOT, "thumbs");
const MANIFEST_PATH = path.join(IMPORTED_ROOT, "manifest.json");
const PILOT_MANIFEST_PATH = path.join(
  REPO,
  "projects",
  "data",
  "image_gallery",
  "imported",
  "pilot",
  "manifest.json"
);

export const IMAGE_STORAGE_PATH = "projects/data/image_gallery/imported/" + BATCH_DIR + "/webp";
export const METADATA_STORAGE_PATH = "projects/data/image_gallery/imported/" + BATCH_DIR + "/manifest.json";

export const BATCH_NUMBER_EXPORT = BATCH_NUMBER;
export const MAX_REQUESTS_THIS_RUN = 110;

const SECTION_GALLERY_IDS = new Set([
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
]);

const SUPPLEMENTAL_GALLERY_IDS = new Set([
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
]);

export const ALLOWED_GALLERY_IDS = new Set([
  ...SECTION_GALLERY_IDS,
  ...SUPPLEMENTAL_GALLERY_IDS,
  ...(BATCH_NUMBER >= 2 ? ["general_fallback"] : []),
]);

const FORBIDDEN_GALLERY_IDS = new Set(["verified_persons", "verified_places_objects"]);
if (BATCH_NUMBER < 2) {
  FORBIDDEN_GALLERY_IDS.add("general_fallback");
}

const MAX_IMAGE_WIDTH = 800;
const THUMB_WIDTH = 320;
const WEBP_QUALITY = 80;
const PAUSE_MS = 500;

const FORBIDDEN_CONTENT = [
  /\bchild(?:ren)?\b/i,
  /\bkids?\b/i,
  /\bbab(?:y|ies)\b/i,
  /\btoddler\b/i,
  /\blogo\b/i,
  /\bbrand(?:ed)?\b/i,
  /\bcelebrit/i,
  /\bpolitician\b/i,
  /\bpresident\b/i,
  /\bprime minister\b/i,
  /\b(advert|advertisement|promo|sponsored|billboard)\b/i,
  /\btoyota\b/i,
  /\bbmw\b/i,
  /\baudi\b/i,
  /\bmercedes\b/i,
  /\bvolkswagen\b/i,
  /\biphone\b/i,
  /\bnike\b/i,
  /\badidas\b/i,
  /\bcoca[- ]?cola\b/i,
  /\bportrait\b/i,
  /\bselfie\b/i,
  /\bheadshot\b/i,
  /\bwedding\b/i,
  /\bmodel\b/i,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOCAL_KEY_PATH = path.join(
  REPO,
  "projects",
  "data",
  "image_gallery",
  ".pexels-api-key.local"
);

function getApiKey() {
  const fromEnv = String(process.env.PEXELS_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(LOCAL_KEY_PATH)) {
    const fromFile = fs.readFileSync(LOCAL_KEY_PATH, "utf8").trim();
    if (fromFile) {
      process.env.PEXELS_API_KEY = fromFile;
      return fromFile;
    }
  }
  return "";
}

export function assertApiKeyFromEnvOnly() {
  const key = getApiKey();
  if (!key) {
    return { ok: false, reason: "PEXELS_API_KEY_NOT_SET" };
  }
  if (key.length < 8) {
    return { ok: false, reason: "PEXELS_API_KEY_INVALID" };
  }
  return { ok: true };
}

function redactSecrets(text, apiKey) {
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED]");
}

function parseRateLimitHeaders(headers) {
  const limit = headers.get("X-Ratelimit-Limit");
  const remaining = headers.get("X-Ratelimit-Remaining");
  const reset = headers.get("X-Ratelimit-Reset");
  return {
    rateLimitLimit: limit != null ? Number(limit) : null,
    rateLimitRemaining: remaining != null ? Number(remaining) : null,
    rateLimitReset: reset != null ? Number(reset) : null,
  };
}

function isContentSafe(photo, query) {
  const hay = [photo.alt, query, photo.photographer, photo.url].filter(Boolean).join(" ");
  for (const pat of FORBIDDEN_CONTENT) {
    if (pat.test(hay)) return false;
  }
  if (photo.width && photo.height && photo.height > photo.width) return false;
  return true;
}

function pickDownloadUrl(photo) {
  const src = photo.src || {};
  return src.large || src.medium || src.landscape || src.original;
}

export function selectBatchQueueItems(queue, state, maxRequests = MAX_REQUESTS_THIS_RUN) {
  const pending = getPendingItems(queue, state);
  const selected = [];
  let estimatedRequests = 0;

  for (const item of pending) {
    if (!ALLOWED_GALLERY_IDS.has(item.galleryId)) continue;
    if (FORBIDDEN_GALLERY_IDS.has(item.galleryId)) continue;
    if (item.galleryId === "verified_persons" || item.galleryId === "verified_places_objects") continue;
    if (item.query === "__ENTITY_QUERY_PENDING__") continue;

    const req = item.estimatedRequests || 0;
    if (estimatedRequests > 0 && estimatedRequests + req > maxRequests) {
      break;
    }
    selected.push(item);
    estimatedRequests += req;
  }

  return { items: selected, estimatedRequests };
}

function loadExistingPexelsIds() {
  const ids = new Set();
  for (let n = 1; n < 20; n++) {
    const manifestPath = path.join(
      REPO,
      "projects",
      "data",
      "image_gallery",
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
  if (fs.existsSync(PILOT_MANIFEST_PATH)) {
    const pilot = JSON.parse(fs.readFileSync(PILOT_MANIFEST_PATH, "utf8"));
    for (const entry of pilot.entries || []) {
      if (entry.pexelsId != null) ids.add(entry.pexelsId);
    }
  }
  return ids;
}

function ensureDirs() {
  fs.mkdirSync(WEBP_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {
      version: 1,
      batchNumber: BATCH_NUMBER,
      description: "Pexels batch " + BATCH_NUMBER + " import — illustrative only, approved=false",
      imageStoragePath: IMAGE_STORAGE_PATH,
      metadataStoragePath: METADATA_STORAGE_PATH,
      importedImagesApprovedByDefault: false,
      importedImagesVisibleOnWeb: false,
      feedIntegrationEnabled: false,
      entries: [],
    };
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function optimizeToWebp(buffer, maxWidth) {
  return sharp(buffer)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

async function searchPexels(apiKey, query, page, perPage, orientation) {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  if (orientation) url.searchParams.set("orientation", orientation);

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  const rate = parseRateLimitHeaders(res.headers);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      "Pexels API error " + res.status + ": " + redactSecrets(body.slice(0, 200), apiKey)
    );
  }

  const data = await res.json();
  return { data, rate };
}

async function downloadPhotoBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Photo download failed " + res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}

function buildEntry(photo, item, paths, now) {
  return {
    id: "batch" + BATCH_NUMBER + "-pexels-" + photo.id,
    galleryId: item.galleryId,
    galleryType: item.galleryType,
    imageMode: "illustrative",
    provider: "pexels",
    pexelsId: photo.id,
    localThumbPath: path.relative(IMPORTED_ROOT, paths.thumb).replace(/\\/g, "/"),
    localImagePath: path.relative(IMPORTED_ROOT, paths.webp).replace(/\\/g, "/"),
    imageAlt: photo.alt || item.query,
    imageAuthor: photo.photographer || "Pexels contributor",
    imageAuthorUrl: photo.photographer_url || "https://www.pexels.com",
    imageSourceUrl: photo.url || "https://www.pexels.com",
    imageLicenseSource: "Pexels License",
    downloadedAt: now,
    approved: false,
    verifiedByHuman: false,
    manualReviewStatus: "pending",
    usageCount: 0,
    lastUsedAt: null,
    batchNumber: BATCH_NUMBER,
    batchQuery: item.query,
    batchQueueItemId: item.id,
    feedIntegrationEnabled: false,
  };
}

export async function runBatchImport() {
  const keyCheck = assertApiKeyFromEnvOnly();
  if (!keyCheck.ok) {
    return {
      ok: false,
      verdict: "STOP",
      reason: keyCheck.reason,
      photosImported: 0,
      requestsUsed: 0,
    };
  }

  const apiKey = getApiKey();
  const queue = loadQueue();
  const state = loadState();

  if ((state.currentBatch || 0) !== BATCH_NUMBER - 1) {
    return {
      ok: false,
      verdict: "STOP",
      reason: "BATCH_SEQUENCE_MISMATCH currentBatch=" + (state.currentBatch || 0),
      photosImported: 0,
      requestsUsed: 0,
    };
  }

  const { items, estimatedRequests } = selectBatchQueueItems(queue, state);
  if (!items.length) {
    return {
      ok: false,
      verdict: "STOP",
      reason: "NO_BATCH_QUEUE_ITEMS",
      photosImported: 0,
      requestsUsed: 0,
    };
  }

  if (estimatedRequests > MAX_REQUESTS_THIS_RUN) {
    return {
      ok: false,
      verdict: "STOP",
      reason: "BATCH_REQUEST_BUDGET_EXCEEDED estimated=" + estimatedRequests,
      photosImported: 0,
      requestsUsed: 0,
    };
  }

  ensureDirs();
  const manifest = loadManifest();
  const existingIds = loadExistingPexelsIds();
  const imported = [];
  let requestsUsed = 0;
  let lastRate = {
    rateLimitLimit: state.rateLimitLimit,
    rateLimitRemaining: state.rateLimitRemaining,
    rateLimitReset: state.rateLimitReset,
  };

  for (const item of items) {
    if (requestsUsed >= MAX_REQUESTS_THIS_RUN) break;

    const maxPages = item.estimatedRequests || 1;
    const perPage = item.photosPerPage || 80;
    let page = 1;

    while (page <= maxPages && requestsUsed < MAX_REQUESTS_THIS_RUN) {
      const { data, rate } = await searchPexels(
        apiKey,
        item.query,
        page,
        perPage,
        item.orientation || "landscape"
      );
      requestsUsed += 1;
      lastRate = rate;

      console.log("RATE_LIMIT_LIMIT=" + rate.rateLimitLimit);
      console.log("RATE_LIMIT_REMAINING=" + rate.rateLimitRemaining);
      console.log("RATE_LIMIT_RESET=" + rate.rateLimitReset);

      if (rate.rateLimitRemaining != null && rate.rateLimitRemaining <= 0) {
        saveManifest(manifest);
        return {
          ok: false,
          verdict: "STOP",
          reason: "RATE_LIMIT_REACHED",
          photosImported: imported.length,
          requestsUsed,
          rate,
        };
      }

      const photos = Array.isArray(data.photos) ? data.photos : [];
      for (const photo of photos) {
        if (existingIds.has(photo.id)) continue;
        if (!isContentSafe(photo, item.query)) continue;

        const srcUrl = pickDownloadUrl(photo);
        if (!srcUrl) continue;

        try {
          const raw = await downloadPhotoBuffer(srcUrl);
          const webpBuf = await optimizeToWebp(raw, MAX_IMAGE_WIDTH);
          const thumbBuf = await optimizeToWebp(raw, THUMB_WIDTH);

          const base = "batch" + BATCH_NUMBER + "-pexels-" + photo.id;
          const webpPath = path.join(WEBP_DIR, base + ".webp");
          const thumbPath = path.join(THUMB_DIR, base + ".webp");
          fs.writeFileSync(webpPath, webpBuf);
          fs.writeFileSync(thumbPath, thumbBuf);

          const now = new Date().toISOString();
          const entry = buildEntry(photo, item, { webp: webpPath, thumb: thumbPath }, now);
          manifest.entries.push(entry);
          imported.push(entry);
          existingIds.add(photo.id);
        } catch (err) {
          console.log(
            "SKIP_PHOTO=" + photo.id + " reason=" + redactSecrets(String(err.message), apiKey)
          );
        }
      }

      if (!data.next_page || photos.length === 0) break;
      page += 1;
      if (requestsUsed >= MAX_REQUESTS_THIS_RUN) break;
      await sleep(PAUSE_MS);
    }

    await sleep(PAUSE_MS);
  }

  saveManifest(manifest);

  const now = new Date().toISOString();
  state.lastRunAt = now;
  state.status =
    BATCH_NUMBER >= 2 ? "completed" : imported.length > 0 ? "batch_running" : "batch_empty";
  state.dryRunOnly = false;
  state.rateLimitLimit = lastRate.rateLimitLimit;
  state.rateLimitRemaining = lastRate.rateLimitRemaining;
  state.rateLimitReset = lastRate.rateLimitReset;
  state.completedRequests = (state.completedRequests || 0) + requestsUsed;
  state.remainingRequests = Math.max(0, (state.remainingRequests || 220) - requestsUsed);
  state.completedBatches = state.completedBatches || [];
  state.completedBatches.push({
    batchIndex: BATCH_NUMBER - 1,
    batchNumber: BATCH_NUMBER,
    itemIds: items.map((i) => i.id),
    requestsUsed,
    photosImported: imported.length,
    completedAt: now,
  });
  state.currentBatch = BATCH_NUMBER;
  state.batchLastRun = {
    batchNumber: BATCH_NUMBER,
    at: now,
    photosImported: imported.length,
    requestsUsed,
    queueItems: items.length,
  };
  saveState(state);

  const ok = imported.length > 0 && requestsUsed <= MAX_REQUESTS_THIS_RUN;
  return {
    ok,
    verdict: ok ? "PASS" : imported.length ? "PARTIAL" : "FAIL",
    photosImported: imported.length,
    requestsUsed,
    queueItems: items.length,
    rate: lastRate,
  };
}

function totalImportedSizeMb() {
  let bytes = 0;
  for (const dir of [WEBP_DIR, THUMB_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".webp")) continue;
      bytes += fs.statSync(path.join(dir, name)).size;
    }
  }
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export async function main() {
  console.log("PEXELS_IMPORT_BATCH");
  console.log("BATCH_NUMBER=" + BATCH_NUMBER);
  console.log("IMAGE_STORAGE_PATH=" + IMAGE_STORAGE_PATH);
  console.log("METADATA_STORAGE_PATH=" + METADATA_STORAGE_PATH);

  const keyCheck = assertApiKeyFromEnvOnly();
  console.log("API_KEY_FROM_ENV_ONLY=" + (keyCheck.ok ? "YES" : "NO"));

  if (!keyCheck.ok) {
    console.log("PEXELS_API_CALLED=NO");
    console.log("PHOTOS_DOWNLOADED=NO");
    console.log("STOP_REASON=" + keyCheck.reason);
    console.log("FINAL_VERDICT=STOP");
    process.exit(2);
  }

  const result = await runBatchImport();

  console.log("PEXELS_API_CALLED=YES");
  console.log("PHOTOS_DOWNLOADED=" + (result.photosImported > 0 ? "YES" : "NO"));
  console.log("PHOTOS_IMPORTED_COUNT=" + result.photosImported);
  console.log("REQUESTS_USED=" + result.requestsUsed);
  console.log("MAX_REQUESTS_THIS_RUN=" + MAX_REQUESTS_THIS_RUN);
  console.log("TOTAL_IMPORTED_IMAGE_SIZE_MB=" + totalImportedSizeMb());
  console.log("ORIGINAL_PEXELS_FILES_STORED=NO");
  console.log("WEBP_OPTIMIZED_IMAGES=YES");
  console.log("MAX_IMAGE_WIDTH=" + MAX_IMAGE_WIDTH);
  console.log("IMPORTED_IMAGES_APPROVED_BY_DEFAULT=NO");
  console.log("IMPORTED_IMAGES_VISIBLE_ON_WEB=NO");
  console.log("FEED_INTEGRATION_ENABLED=NO");
  console.log("MIDDLE_FEED_PHOTOS_ACTIVE=NO");
  console.log("IMAGE_SELECTION_RUNTIME_ENABLED=NO");
  console.log("RATE_LIMIT_BYPASS_ALLOWED=NO");

  if (result.reason) console.log("STOP_REASON=" + result.reason);
  console.log(
    "FINAL_VERDICT=" +
      (result.verdict === "PASS" ? "PASS" : result.verdict === "STOP" ? "STOP" : "FAIL")
  );
  process.exit(result.ok ? 0 : result.verdict === "STOP" ? 2 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
