#!/usr/bin/env node
/**
 * Shared critical-section writer for info_events feed/monitoring.
 *
 * Contract:
 * - Call ONLY while holding GitHub Actions concurrency group info-events-data-writers.
 * - ALWAYS re-read live feed.json + monitoring.json from targetDir before merge.
 * - Namespace-safe: CHMI / NDIC / other ownership preserved across writers.
 *
 * Offline fixtures import this module; workflows invoke via CLI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isOwnedByChmiCapV2,
  isOwnedByNdicDatexV1,
  composeFeedItemsWithForeignNamespaces,
  composeMonitoringWithForeignNamespaces,
} from "./iu-info-events-namespace-compose.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DEFAULT_DIR = path.join(REPO, "projects", "data", "info_events");

export const SHARED_WRITER_GROUP = "info-events-data-writers";

export function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

export function isChmiItem(item) {
  return isOwnedByChmiCapV2(item) || (item && String(item.sourceId || "") === "chmi");
}

export function isNdicItem(item) {
  return isOwnedByNdicDatexV1(item);
}

/** Merge CHMI-owned items into latest shared feed (re-read already done by caller). */
export function mergeChmiItemsIntoFeed(liveFeed, chmiItems) {
  const prev = liveFeed && typeof liveFeed === "object" ? liveFeed : { items: [] };
  const items = Array.isArray(prev.items) ? prev.items : [];
  const chmi = Array.isArray(chmiItems) ? chmiItems.filter(Boolean) : [];
  const others = items.filter((i) => !isChmiItem(i));
  const nextItems = others.concat(chmi);
  return {
    ...prev,
    itemCount: nextItems.length,
    items: nextItems,
    chmiCapV2Active: true,
  };
}

/** Merge NDIC-owned items into latest shared feed. */
export function mergeNdicItemsIntoFeed(liveFeed, ndicItems) {
  const prev = liveFeed && typeof liveFeed === "object" ? liveFeed : { items: [] };
  const items = Array.isArray(prev.items) ? prev.items : [];
  const ndic = Array.isArray(ndicItems) ? ndicItems.filter(Boolean) : [];
  const others = items.filter((i) => !isNdicItem(i));
  const nextItems = others.concat(ndic);
  return {
    ...prev,
    itemCount: nextItems.length,
    items: nextItems,
    ndicDatexV1Active: true,
  };
}

/** Info-events owned merge: preserve foreign namespaces from LIVE feed. */
export function mergeInfoEventsOwnedIntoFeed(liveFeed, candidateFeed) {
  const liveItems = liveFeed && Array.isArray(liveFeed.items) ? liveFeed.items : [];
  const candItems = candidateFeed && Array.isArray(candidateFeed.items) ? candidateFeed.items : [];
  const composed = composeFeedItemsWithForeignNamespaces(liveItems, candItems);
  return {
    ...(candidateFeed && typeof candidateFeed === "object" ? candidateFeed : {}),
    ...liveFeed,
    items: composed,
    itemCount: composed.length,
    generatedAt: (candidateFeed && candidateFeed.generatedAt) || (liveFeed && liveFeed.generatedAt),
  };
}

export function assertNamespacePreservation(beforeItems, afterItems, writer) {
  const before = Array.isArray(beforeItems) ? beforeItems : [];
  const after = Array.isArray(afterItems) ? afterItems : [];
  const afterIds = new Set(after.map((i) => String(i && i.id || "")).filter(Boolean));
  const w = String(writer || "");

  if (w !== "chmi") {
    for (const it of before.filter(isChmiItem)) {
      const id = String(it.id || "");
      if (id && !afterIds.has(id)) {
        throw new Error("NAMESPACE_VIOLATION: " + w + " dropped CHMI id " + id);
      }
    }
  }
  if (w !== "ndic") {
    for (const it of before.filter(isNdicItem)) {
      const id = String(it.id || "");
      if (id && !afterIds.has(id)) {
        throw new Error("NAMESPACE_VIOLATION: " + w + " dropped NDIC id " + id);
      }
    }
  }
  if (w === "chmi" || w === "ndic") {
    for (const it of before) {
      if (!it) continue;
      if (w === "chmi" && isChmiItem(it)) continue;
      if (w === "ndic" && isNdicItem(it)) continue;
      if (isChmiItem(it) || isNdicItem(it)) continue;
      const id = String(it.id || "");
      if (id && !afterIds.has(id)) {
        throw new Error("NAMESPACE_VIOLATION: " + w + " dropped OTHER id " + id);
      }
    }
  }
  return true;
}

export function mergeChmiMonitoring(liveMonitoring, chmiCapV2Block) {
  const live = liveMonitoring && typeof liveMonitoring === "object" ? { ...liveMonitoring } : {};
  if (!live.datasetAges || typeof live.datasetAges.feedAgeHours !== "number") {
    throw new Error("SHARED_MONITORING_INVALID: missing datasetAges.feedAgeHours");
  }
  if (!Array.isArray(live.alerts)) throw new Error("SHARED_MONITORING_INVALID: missing alerts[]");
  if (!Array.isArray(live.outageHistory)) {
    throw new Error("SHARED_MONITORING_INVALID: missing outageHistory[]");
  }
  if (chmiCapV2Block && typeof chmiCapV2Block === "object") {
    live.chmiCapV2 = chmiCapV2Block;
  }
  return live;
}

export function mergeNdicMonitoring(liveMonitoring, ndicBlock) {
  const live = liveMonitoring && typeof liveMonitoring === "object" ? { ...liveMonitoring } : {};
  if (!live.datasetAges || typeof live.datasetAges.feedAgeHours !== "number") {
    throw new Error("SHARED_MONITORING_INVALID: missing datasetAges.feedAgeHours");
  }
  if (!Array.isArray(live.alerts)) throw new Error("SHARED_MONITORING_INVALID: missing alerts[]");
  if (!Array.isArray(live.outageHistory)) {
    throw new Error("SHARED_MONITORING_INVALID: missing outageHistory[]");
  }
  if (ndicBlock && typeof ndicBlock === "object") {
    live.ndicDatexV1 = ndicBlock;
  }
  return live;
}

/**
 * Apply CHMI candidate onto LIVE targetDir (must already be refreshed to main tip).
 * candidateDir contains prep outputs: feed.json (with chmi items), monitoring.json, chmi_cap_v2/, lanes/pocasi.json
 */
export function applyChmiCandidate({ targetDir, candidateDir, nowIso }) {
  const liveFeedPath = path.join(targetDir, "feed.json");
  const liveMonPath = path.join(targetDir, "monitoring.json");
  const liveFeed = readJson(liveFeedPath, null);
  const liveMon = readJson(liveMonPath, null);
  if (!liveFeed || !Array.isArray(liveFeed.items)) {
    throw new Error("SHARED_FEED_REREAD_FAIL: live feed.json missing");
  }
  if (!liveMon || typeof liveMon !== "object") {
    throw new Error("SHARED_MONITORING_REREAD_FAIL: live monitoring.json missing");
  }

  const candFeed = readJson(path.join(candidateDir, "feed.json"), { items: [] });
  const candMon = readJson(path.join(candidateDir, "monitoring.json"), {});
  const chmiItems = (candFeed.items || []).filter(isChmiItem);
  const before = liveFeed.items.slice();
  const nextFeed = mergeChmiItemsIntoFeed(liveFeed, chmiItems);
  nextFeed.generatedAt = nowIso || nextFeed.generatedAt || candFeed.generatedAt;
  assertNamespacePreservation(before, nextFeed.items, "chmi");

  const nextMon = mergeChmiMonitoring(liveMon, candMon.chmiCapV2);
  writeJsonAtomic(liveFeedPath, nextFeed);
  writeJsonAtomic(liveMonPath, nextMon);

  const candLane = path.join(candidateDir, "lanes", "pocasi.json");
  const liveLane = path.join(targetDir, "lanes", "pocasi.json");
  if (fs.existsSync(candLane)) {
    const laneCand = readJson(candLane, null);
    const laneLive = readJson(liveLane, laneCand || { items: [] });
    if (laneCand && laneLive) {
      const others = (laneLive.items || []).filter((i) => !isChmiItem(i));
      const merged = others.concat((laneCand.items || []).filter(isChmiItem));
      writeJsonAtomic(liveLane, {
        ...laneLive,
        generatedAt: nowIso || laneCand.generatedAt,
        itemCount: merged.length,
        items: merged,
      });
    }
  }

  const candState = path.join(candidateDir, "chmi_cap_v2");
  const liveState = path.join(targetDir, "chmi_cap_v2");
  if (fs.existsSync(candState)) {
    fs.mkdirSync(liveState, { recursive: true });
    for (const name of fs.readdirSync(candState)) {
      if (name === "shadow_feed.json") continue;
      const src = path.join(candState, name);
      if (!fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, path.join(liveState, name));
    }
  }

  return { ok: true, writer: "chmi", itemCount: nextFeed.itemCount, rereadAfterLock: true };
}

/**
 * Apply NDIC candidate onto LIVE targetDir after re-read.
 * candidateDir: feed.json (ndic items), monitoring.json, lanes/doprava.json, ndic_datex_v1/*
 */
export function applyNdicCandidate({ targetDir, candidateDir, nowIso }) {
  const liveFeedPath = path.join(targetDir, "feed.json");
  const liveMonPath = path.join(targetDir, "monitoring.json");
  const liveFeed = readJson(liveFeedPath, null);
  const liveMon = readJson(liveMonPath, null);
  if (!liveFeed || !Array.isArray(liveFeed.items)) {
    throw new Error("SHARED_FEED_REREAD_FAIL: live feed.json missing");
  }
  if (!liveMon || typeof liveMon !== "object") {
    throw new Error("SHARED_MONITORING_REREAD_FAIL: live monitoring.json missing");
  }

  const candFeed = readJson(path.join(candidateDir, "feed.json"), { items: [] });
  const candMon = readJson(path.join(candidateDir, "monitoring.json"), {});
  const ndicItems = (candFeed.items || []).filter(isNdicItem);
  const before = liveFeed.items.slice();
  const nextFeed = mergeNdicItemsIntoFeed(liveFeed, ndicItems);
  nextFeed.generatedAt = nowIso || nextFeed.generatedAt || candFeed.generatedAt;
  assertNamespacePreservation(before, nextFeed.items, "ndic");

  const nextMon = mergeNdicMonitoring(liveMon, candMon.ndicDatexV1);
  writeJsonAtomic(liveFeedPath, nextFeed);
  writeJsonAtomic(liveMonPath, nextMon);

  const candLane = path.join(candidateDir, "lanes", "doprava.json");
  const liveLane = path.join(targetDir, "lanes", "doprava.json");
  if (fs.existsSync(candLane)) {
    const laneCand = readJson(candLane, null);
    const laneLive = readJson(liveLane, laneCand || { items: [] });
    if (laneCand && laneLive) {
      const others = (laneLive.items || []).filter((i) => !isNdicItem(i));
      const merged = others.concat((laneCand.items || []).filter(isNdicItem));
      writeJsonAtomic(liveLane, {
        ...laneLive,
        generatedAt: nowIso || laneCand.generatedAt,
        itemCount: merged.length,
        items: merged,
      });
    }
  }

  const candState = path.join(candidateDir, "ndic_datex_v1");
  const liveState = path.join(targetDir, "ndic_datex_v1");
  if (fs.existsSync(candState)) {
    fs.mkdirSync(liveState, { recursive: true });
    for (const name of fs.readdirSync(candState)) {
      if (name === "shadow_feed.json" || name === "raw") continue;
      const src = path.join(candState, name);
      const st = fs.statSync(src);
      if (st.isFile()) {
        fs.copyFileSync(src, path.join(liveState, name));
      }
    }
  }

  return { ok: true, writer: "ndic", itemCount: nextFeed.itemCount, rereadAfterLock: true };
}

/**
 * Apply info-events candidate: re-read live foreign namespaces, keep IE-owned from candidate.
 */
export function applyInfoEventsCandidate({ targetDir, candidateDir, nowIso }) {
  const liveFeedPath = path.join(targetDir, "feed.json");
  const liveMonPath = path.join(targetDir, "monitoring.json");
  const liveFeed = readJson(liveFeedPath, null);
  const liveMon = readJson(liveMonPath, null);
  if (!liveFeed || !Array.isArray(liveFeed.items)) {
    throw new Error("SHARED_FEED_REREAD_FAIL: live feed.json missing");
  }
  if (!liveMon || typeof liveMon !== "object") {
    throw new Error("SHARED_MONITORING_REREAD_FAIL: live monitoring.json missing");
  }

  const candFeed = readJson(path.join(candidateDir, "feed.json"), { items: [] });
  const candMon = readJson(path.join(candidateDir, "monitoring.json"), {});
  const before = liveFeed.items.slice();
  const nextFeed = mergeInfoEventsOwnedIntoFeed(liveFeed, candFeed);
  nextFeed.generatedAt = nowIso || candFeed.generatedAt || nextFeed.generatedAt;
  assertNamespacePreservation(before, nextFeed.items, "info-events");

  const nextMon = composeMonitoringWithForeignNamespaces(liveMon, candMon);
  writeJsonAtomic(liveFeedPath, nextFeed);
  writeJsonAtomic(liveMonPath, nextMon);

  // Copy non-foreign IE artifacts from candidate (lanes except those we namespace-merge carefully)
  for (const name of ["metadata.json", "manifest.json", "taxonomy.json", "source_registry.json", "legal_source_registry.json"]) {
    const src = path.join(candidateDir, name);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(targetDir, name));
    }
  }
  const candLanes = path.join(candidateDir, "lanes");
  const liveLanes = path.join(targetDir, "lanes");
  if (fs.existsSync(candLanes)) {
    fs.mkdirSync(liveLanes, { recursive: true });
    for (const laneName of fs.readdirSync(candLanes)) {
      if (laneName === "pocasi.json" || laneName === "doprava.json") {
        // Preserve foreign lane items from LIVE; replace IE-owned from candidate.
        const liveLane = readJson(path.join(liveLanes, laneName), { items: [] });
        const candLane = readJson(path.join(candLanes, laneName), { items: [] });
        const foreign =
          laneName === "pocasi.json"
            ? (liveLane.items || []).filter(isChmiItem)
            : (liveLane.items || []).filter(isNdicItem);
        const foreignIds = new Set(foreign.map((i) => String(i.id || "")));
        const owned = (candLane.items || []).filter((i) => {
          if (laneName === "pocasi.json" && isChmiItem(i)) return false;
          if (laneName === "doprava.json" && isNdicItem(i)) return false;
          const id = String(i && i.id || "");
          return !id || !foreignIds.has(id);
        });
        const merged = foreign.concat(owned);
        writeJsonAtomic(path.join(liveLanes, laneName), {
          ...candLane,
          ...liveLane,
          generatedAt: nowIso || candLane.generatedAt,
          itemCount: merged.length,
          items: merged,
        });
      } else {
        fs.copyFileSync(path.join(candLanes, laneName), path.join(liveLanes, laneName));
      }
    }
  }

  return { ok: true, writer: "info-events", itemCount: nextFeed.itemCount, rereadAfterLock: true };
}

function cliMain(argv) {
  const writer = String(argv[2] || "");
  const candidateDir = String(argv[3] || "");
  const targetDir = String(argv[4] || DEFAULT_DIR);
  const nowIso = new Date().toISOString();
  if (!writer || !candidateDir) {
    console.error("Usage: node info-events-shared-writer-critical.mjs <chmi|ndic|info-events> <candidateDir> [targetDir]");
    process.exit(2);
  }
  let result;
  if (writer === "chmi") result = applyChmiCandidate({ targetDir, candidateDir, nowIso });
  else if (writer === "ndic") result = applyNdicCandidate({ targetDir, candidateDir, nowIso });
  else if (writer === "info-events") result = applyInfoEventsCandidate({ targetDir, candidateDir, nowIso });
  else {
    console.error("Unknown writer: " + writer);
    process.exit(2);
  }
  console.log(JSON.stringify({ ...result, SHARED_STATE_REREAD_AFTER_LOCK: "YES" }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) cliMain(process.argv);
