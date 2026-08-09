/**
 * NDIC sync core — locks, conditional HTTP, sanity guards, atomic publish decision.
 * Reuses CHMI lock/backoff helpers for consistency.
 */
import crypto from "crypto";
import {
  tryAcquireLock,
  releaseLock,
  nextBackoffUntil,
  parseRetryAfter,
  applyConditionalResult,
  createSyncState,
  createLockState,
  atomicPublishDecision,
  suspiciousDrop,
} from "../chmi-cap-v2/sync-core.mjs";
import { DEFAULT_SANITY, DEFAULT_BACKOFF_MINUTES } from "./config.mjs";
import { parseDatexSituationPublication } from "./parse-datex.mjs";
import {
  situationsToFeedItems,
  mergeNdicRevisions,
  applyNdicPublishGate,
  loadNdicFirstSeenById,
  isPublishableNdicItem,
} from "./normalize-feed.mjs";

export {
  tryAcquireLock,
  releaseLock,
  nextBackoffUntil,
  parseRetryAfter,
  applyConditionalResult,
  createSyncState,
  createLockState,
  atomicPublishDecision,
  suspiciousDrop,
};

export function sanityCheckSnapshot(prevCount, nextCount, opts = {}) {
  const s = { ...DEFAULT_SANITY, ...(opts.sanity || {}) };
  const alarms = [];
  if (s.emptySnapshotFail && nextCount === 0 && prevCount > 0) {
    alarms.push({ code: "EMPTY_SNAPSHOT", prev: prevCount, next: nextCount });
  }
  if (prevCount >= s.minPrevForDropGuard && nextCount / prevCount < s.suspiciousDropRatio) {
    alarms.push({ code: "SUSPICIOUS_DROP", prev: prevCount, next: nextCount });
  }
  if (prevCount >= s.minPrevForDropGuard && nextCount > prevCount * s.maxGrowthRatio) {
    alarms.push({ code: "SUSPICIOUS_GROWTH", prev: prevCount, next: nextCount });
  }
  return { ok: alarms.length === 0, alarms };
}

/**
 * Process one DATEX body into merge-ready items.
 */
export function processDatexBody(body, opts = {}) {
  const parsed = parseDatexSituationPublication(body, { limits: opts.limits });
  const firstSeenMap = opts.firstSeenMap || loadNdicFirstSeenById(opts.prevItems || []);
  const { items, quarantine } = situationsToFeedItems(parsed.situations, {
    tmcTable: opts.tmcTable,
    nowIso: opts.nowIso,
    geoRegistry: opts.geoRegistry,
    firstSeenMap,
  });
  const merged = mergeNdicRevisions(opts.prevItems || [], items, { nowIso: opts.nowIso });
  return {
    parsed,
    items: merged.items,
    all: merged.all,
    stats: merged.stats,
    quarantine,
    rejectedParse: parsed.rejected,
  };
}

/**
 * Full pipeline step used by prod-sync and tests.
 */
export function processAndGate(body, opts = {}) {
  const processed = processDatexBody(body, opts);
  const gate = applyNdicPublishGate(processed.items, {
    repoRoot: opts.repoRoot,
    legalRegistry: opts.legalRegistry,
    sourceRegistry: opts.sourceRegistry,
  });
  const prevPub = (opts.prevItems || []).filter(isPublishableNdicItem).length;
  const sanity = sanityCheckSnapshot(prevPub, gate.items.length, { sanity: opts.sanity });
  const unlocalized = gate.items.filter((i) => i.localizationTrust === "national_fallback").length;
  const unlocRatio = gate.items.length ? unlocalized / gate.items.length : 0;
  if (unlocRatio > (opts.sanity && opts.sanity.maxUnlocalizedRatio != null ? opts.sanity.maxUnlocalizedRatio : DEFAULT_SANITY.maxUnlocalizedRatio)) {
    sanity.alarms.push({ code: "HIGH_UNLOCALIZED", ratio: unlocRatio });
    sanity.ok = false;
  }
  return { ...processed, gate, sanity };
}

export function basicAuthHeader(user, pass) {
  return "Basic " + Buffer.from(String(user) + ":" + String(pass), "utf8").toString("base64");
}

export function redactSecrets(obj) {
  const s = JSON.stringify(obj);
  return s
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic ***")
    .replace(/("pass(word)?":\s*")[^"]+"/gi, '$1***"')
    .replace(/("Authorization":\s*")[^"]+"/gi, '$1***"');
}

export function runId() {
  return crypto.randomBytes(8).toString("hex");
}

export { DEFAULT_BACKOFF_MINUTES };
