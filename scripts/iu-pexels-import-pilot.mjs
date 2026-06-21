#!/usr/bin/env node
/**
 * Pexels import V1 pilot — manual illustrative batch only (20–50 photos).
 * Requires PEXELS_API_KEY in environment. Never logs or commits the key.
 * Run: npm run pexels-import-pilot
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { loadQueue, loadState, saveState } from "./iu-pexels-import-runner.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORTED_ROOT = path.join(REPO, "projects", "data", "image_gallery", "imported", "pilot");
const WEBP_DIR = path.join(IMPORTED_ROOT, "webp");
const THUMB_DIR = path.join(IMPORTED_ROOT, "thumbs");
const MANIFEST_PATH = path.join(IMPORTED_ROOT, "manifest.json");

export const IMAGE_STORAGE_PATH = "projects/data/image_gallery/imported/pilot/webp";
export const METADATA_STORAGE_PATH = "projects/data/image_gallery/imported/pilot/manifest.json";

const PILOT_GALLERY_IDS = new Set(["general_fallback", "priroda", "doprava"]);
const PILOT_QUEUE_ITEM_IDS = [
  "priroda-0-nature-forest-landscape",
  "doprava-0-transport-traffic-highway",
  "general_fallback-0-abstract-news-background",
];

const MAX_REQUESTS_THIS_RUN = 10;
const PILOT_PHOTO_TARGET_MIN = 20;
const PILOT_PHOTO_TARGET_MAX = 50;
const PER_PAGE = 15;
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

const FORBIDDEN_GALLERY_IDS = new Set(["verified_persons", "verified_places_objects", "politika"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey() {
  return String(process.env.PEXELS_API_KEY || "").trim();
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
  const hay = [
    photo.alt,
    query,
    photo.photographer,
    photo.url,
  ]
    .filter(Boolean)
    .join(" ");
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

export function selectPilotQueueItems(queue) {
  const byId = new Map((queue.items || []).map((item) => [item.id, item]));
  const selected = [];
  for (const id of PILOT_QUEUE_ITEM_IDS) {
    const item = byId.get(id);
    if (!item) continue;
    if (!PILOT_GALLERY_IDS.has(item.galleryId)) continue;
    if (FORBIDDEN_GALLERY_IDS.has(item.galleryId)) continue;
    if (item.galleryId === "verified_persons" || item.galleryId === "verified_places_objects") continue;
    selected.push(item);
  }
  return selected;
}

function ensureDirs() {
  fs.mkdirSync(WEBP_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {
      version: 1,
      pilotImportMode: true,
      description: "Pexels pilot import — illustrative only, approved=false",
      imageStoragePath: IMAGE_STORAGE_PATH,
      metadataStoragePath: METADATA_STORAGE_PATH,
      importedImagesApprovedByDefault: false,
      importedImagesVisibleOnWeb: false,
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

async function searchPexels(apiKey, query, page, perPage) {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "landscape");

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  const rate = parseRateLimitHeaders(res.headers);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      "Pexels API error " +
        res.status +
        ": " +
        redactSecrets(body.slice(0, 200), apiKey)
    );
  }

  const data = await res.json();
  return { data, rate, requestUrl: url.pathname + url.search };
}

async function downloadPhotoBuffer(url, apiKey) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Photo download failed " + res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}

function buildEntry(photo, item, paths, now) {
  return {
    id: "pilot-pexels-" + photo.id,
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
    usageCount: 0,
    lastUsedAt: null,
    pilotQuery: item.query,
    pilotQueueItemId: item.id,
  };
}

export async function runPilotImport() {
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
  const items = selectPilotQueueItems(queue);

  if (!items.length) {
    return { ok: false, verdict: "STOP", reason: "NO_PILOT_QUEUE_ITEMS", photosImported: 0, requestsUsed: 0 };
  }

  ensureDirs();
  const manifest = loadManifest();
  const existingIds = new Set((manifest.entries || []).map((e) => e.pexelsId));
  const imported = [];
  let requestsUsed = 0;
  let lastRate = {
    rateLimitLimit: state.rateLimitLimit,
    rateLimitRemaining: state.rateLimitRemaining,
    rateLimitReset: state.rateLimitReset,
  };

  for (const item of items) {
    if (imported.length >= PILOT_PHOTO_TARGET_MAX) break;
    if (requestsUsed >= MAX_REQUESTS_THIS_RUN) break;

    let page = 1;
    while (
      imported.length < PILOT_PHOTO_TARGET_MAX &&
      requestsUsed < MAX_REQUESTS_THIS_RUN
    ) {
      if (imported.length >= PILOT_PHOTO_TARGET_MIN && requestsUsed >= items.length) {
        break;
      }

      const { data, rate } = await searchPexels(apiKey, item.query, page, PER_PAGE);
      requestsUsed += 1;
      lastRate = rate;

      console.log("RATE_LIMIT_LIMIT=" + rate.rateLimitLimit);
      console.log("RATE_LIMIT_REMAINING=" + rate.rateLimitRemaining);
      console.log("RATE_LIMIT_RESET=" + rate.rateLimitReset);

      if (rate.rateLimitRemaining != null && rate.rateLimitRemaining <= 0) {
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
        if (imported.length >= PILOT_PHOTO_TARGET_MAX) break;
        if (existingIds.has(photo.id)) continue;
        if (!isContentSafe(photo, item.query)) continue;

        const srcUrl = pickDownloadUrl(photo);
        if (!srcUrl) continue;

        try {
          const raw = await downloadPhotoBuffer(srcUrl, apiKey);
          const webpBuf = await optimizeToWebp(raw, MAX_IMAGE_WIDTH);
          const thumbBuf = await optimizeToWebp(raw, THUMB_WIDTH);

          const base = "pilot-pexels-" + photo.id;
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
          console.log("SKIP_PHOTO=" + photo.id + " reason=" + redactSecrets(String(err.message), apiKey));
        }
      }

      if (!data.next_page || photos.length === 0) break;
      page += 1;
      if (requestsUsed >= MAX_REQUESTS_THIS_RUN) break;
      await sleep(PAUSE_MS);
    }

    if (imported.length >= PILOT_PHOTO_TARGET_MIN) break;
    await sleep(PAUSE_MS);
  }

  saveManifest(manifest);

  const now = new Date().toISOString();
  state.lastRunAt = now;
  state.status = imported.length >= PILOT_PHOTO_TARGET_MIN ? "pilot_completed" : "pilot_partial";
  state.dryRunOnly = false;
  state.pilotImportMode = true;
  state.rateLimitLimit = lastRate.rateLimitLimit;
  state.rateLimitRemaining = lastRate.rateLimitRemaining;
  state.rateLimitReset = lastRate.rateLimitReset;
  state.completedRequests = (state.completedRequests || 0) + requestsUsed;
  state.remainingRequests = Math.max(0, (state.remainingRequests || 220) - requestsUsed);
  state.pilotLastRun = {
    at: now,
    photosImported: imported.length,
    requestsUsed,
    galleryIds: [...PILOT_GALLERY_IDS],
  };
  saveState(state);

  const ok = imported.length >= PILOT_PHOTO_TARGET_MIN && imported.length <= PILOT_PHOTO_TARGET_MAX;
  return {
    ok,
    verdict: ok ? "PASS" : imported.length ? "PARTIAL" : "FAIL",
    photosImported: imported.length,
    requestsUsed,
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

async function main() {
  console.log("PEXELS_IMPORT_PILOT");
  console.log("PILOT_IMPORT_MODE=YES");
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

  const result = await runPilotImport();

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
  console.log("BINARY_IMAGES_COMMITTED=NO");

  if (result.reason) console.log("STOP_REASON=" + result.reason);
  console.log("FINAL_VERDICT=" + (result.verdict === "PASS" ? "PASS" : result.verdict === "STOP" ? "STOP" : "FAIL"));
  process.exit(result.ok ? 0 : result.verdict === "STOP" ? 2 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
