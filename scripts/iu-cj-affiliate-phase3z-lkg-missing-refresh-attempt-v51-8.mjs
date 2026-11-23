#!/usr/bin/env node
/**
 * V51.8 — real MISSING_REFRESH attempt ledger (productIds + V38 reverify).
 * Never mass-deletes. Classifies every attempted key into an honest status.
 */
import fs from "node:fs";
import path from "node:path";
import {
  auditLkgFromOffersDoc,
  classifyLkgProductFull,
  LKG_CAUSE,
} from "./iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8.mjs";
import { reverifyMissProductsFromCj } from "./iu-cj-affiliate-phase3z-miss-reverify-v38.mjs";
import {
  mergeRefreshedProductIntoCard,
} from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";
import { REFRESH_RESULT } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

export const ATTEMPT_STATUS = Object.freeze({
  REFRESHED: "REFRESHED",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  PARTNERSHIP_ENDED: "PARTNERSHIP_ENDED",
  INVALID_DATA: "INVALID_DATA",
  RETRY_SCHEDULED: "RETRY_SCHEDULED",
  TECHNICAL_FAILURE: "TECHNICAL_FAILURE",
});

const DEFAULT_URL = "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";
export const RETRY_QUEUE_SCHEMA = "iu-cj-affiliate-phase3z-lkg-refresh-retry-queue-v51-8";
export const RETRY_QUEUE_FILENAME = "iu-affiliate-cj-lkg-refresh-retry-queue-v51-8.json";
const DEFAULT_RETRY_HOURS = 3;
const MAX_RETRY_ATTEMPTS = 12;

/**
 * Map V38 probe row → attempt status (honest, no PASS renaming).
 */
export function classifyAttemptStatus(probe, opts = {}) {
  const p = probe || {};
  const partnerStatus = String(opts.partnershipStatus || opts.partnerStatus || "");
  if (/ENDED|TERMINATED|REMOVED/i.test(partnerStatus)) {
    return ATTEMPT_STATUS.PARTNERSHIP_ENDED;
  }
  if (p.recovered === true) return ATTEMPT_STATUS.REFRESHED;
  const api = String(p.apiResult || "");
  if (api === "skipped_no_credentials_or_empty") return ATTEMPT_STATUS.RETRY_SCHEDULED;
  if (api === "scoped_error" || /error/i.test(api)) return ATTEMPT_STATUS.TECHNICAL_FAILURE;
  if (p.identityRepair || api.includes("collision") || api.includes("different_advertiser")) {
    return ATTEMPT_STATUS.INVALID_DATA;
  }
  if (opts.emptyApiPartner === true) return ATTEMPT_STATUS.SOURCE_UNAVAILABLE;
  if (
    api === "scoped_productIds_miss" ||
    api === "omitPartner_productIds_miss" ||
    api.includes("miss")
  ) {
    return ATTEMPT_STATUS.PRODUCT_NOT_FOUND;
  }
  if (opts.forceRetry === true) return ATTEMPT_STATUS.RETRY_SCHEDULED;
  return ATTEMPT_STATUS.TECHNICAL_FAILURE;
}

/**
 * Select MISSING_REFRESH (+ optional stale LKG) keys from an offers doc or prebuilt audit.
 */
export function selectMissingRefreshTargets(docOrAudit, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  let audit = docOrAudit;
  if (docOrAudit?.sections) {
    audit = auditLkgFromOffersDoc(docOrAudit, { nowMs, source: opts.source || null });
  }
  const carried = Array.isArray(audit?.carried) ? audit.carried : [];
  const hold = Array.isArray(audit?.hold) ? audit.hold : [];
  const includeHoldMissing = opts.includeHoldMissing === true;
  const pool = includeHoldMissing ? [...carried, ...hold] : carried;
  const selected = pool.filter((row) => {
    if (row?.causeCode === LKG_CAUSE.MISSING_REFRESH) return true;
    if (opts.includeSourceTimestampCarry === true) {
      return row?.causeCode === LKG_CAUSE.SOURCE_TIMESTAMP_UNAVAILABLE_CARRY;
    }
    return false;
  });
  const seen = new Set();
  const keys = [];
  for (const row of selected) {
    const adv = String(row.advertiserId || "").trim();
    const pid = String(row.productId || "").trim();
    if (!adv || !pid) continue;
    const key = `${adv}|${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({
      key,
      advertiserId: adv,
      productId: pid,
      title: row.title || null,
      partnershipStatus: row.partnershipStatus || null,
      causeCode: row.causeCode,
      dataAgeHours: row.dataAgeHours,
      lastVerifiedAt: row.lastVerifiedAt || null,
      feedId: row.feedId || null,
    });
  }
  return {
    auditSummary: {
      carriedCount: audit?.carriedCount ?? carried.length,
      holdCount: audit?.holdCount ?? hold.length,
      byCause: audit?.byCause || null,
    },
    targets: keys,
  };
}

export function emptyRetryQueue(nowIso = new Date().toISOString()) {
  return {
    schema: RETRY_QUEUE_SCHEMA,
    updatedAt: nowIso,
    items: {},
    note:
      "Durable RETRY_SCHEDULED / INVALID_DATA queue. Survives run restart; due items are re-attempted automatically.",
  };
}

export function loadRetryQueue(raw) {
  if (!raw || typeof raw !== "object") return emptyRetryQueue();
  return {
    ...emptyRetryQueue(raw.updatedAt || undefined),
    ...raw,
    schema: RETRY_QUEUE_SCHEMA,
    items: raw.items && typeof raw.items === "object" ? raw.items : {},
  };
}

export function readRetryQueueFile(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return emptyRetryQueue();
  try {
    return loadRetryQueue(JSON.parse(fs.readFileSync(absPath, "utf8")));
  } catch {
    return emptyRetryQueue();
  }
}

/**
 * Merge MISSING_REFRESH selection with durable queue due items (no double-count).
 */
export function mergeTargetsWithRetryQueue(selectedTargets, queue, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const byKey = new Map();
  for (const t of selectedTargets || []) {
    const key = t.key || `${t.advertiserId}|${t.productId}`;
    byKey.set(key, { ...t, key, fromQueue: false });
  }
  let dueFromQueue = 0;
  let deferredNotDue = 0;
  for (const [key, item] of Object.entries(queue?.items || {})) {
    if (!item || !item.advertiserId || !item.productId) continue;
    if (item.closed === true) continue;
    if (item.status === ATTEMPT_STATUS.REFRESHED) continue;
    // INVALID_DATA stays tracked but is not auto-retried unless forceRetryInvalid.
    if (
      item.status === ATTEMPT_STATUS.INVALID_DATA &&
      opts.forceRetryInvalid !== true
    ) {
      continue;
    }
    const nextMs = Date.parse(item.nextAttemptAt || "");
    const due =
      item.status === ATTEMPT_STATUS.RETRY_SCHEDULED ||
      item.status === ATTEMPT_STATUS.TECHNICAL_FAILURE ||
      item.status === ATTEMPT_STATUS.PRODUCT_NOT_FOUND;
    if (!due) continue;
    if (Number.isFinite(nextMs) && nextMs > nowMs) {
      deferredNotDue += 1;
      continue;
    }
    if (byKey.has(key)) {
      byKey.set(key, {
        ...byKey.get(key),
        fromQueue: true,
        queueAttemptCount: item.attemptCount || 0,
        priorQueueStatus: item.status,
      });
    } else {
      dueFromQueue += 1;
      byKey.set(key, {
        key,
        advertiserId: String(item.advertiserId),
        productId: String(item.productId),
        title: item.title || null,
        partnershipStatus: item.partnershipStatus || null,
        causeCode: item.priorCauseCode || LKG_CAUSE.MISSING_REFRESH,
        dataAgeHours: item.dataAgeHours ?? null,
        lastVerifiedAt: item.lastVerifiedAt || null,
        feedId: item.feedId || null,
        fromQueue: true,
        queueAttemptCount: item.attemptCount || 0,
        priorQueueStatus: item.status,
      });
    }
  }
  return {
    targets: [...byKey.values()],
    dueFromQueue,
    deferredNotDue,
    selectedOnly: (selectedTargets || []).length,
  };
}

/**
 * Persist attempt outcomes into durable queue (survives restart / next schedule).
 */
export function updateRetryQueueFromAttempts(priorQueue, attempts, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const retryHours = Math.max(1, Number(opts.retryHours) || DEFAULT_RETRY_HOURS);
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || MAX_RETRY_ATTEMPTS);
  const next = loadRetryQueue(priorQueue);
  next.updatedAt = nowIso;
  next.runId = opts.runId || next.runId || null;
  const nextAttemptAt = new Date(Date.parse(nowIso) + retryHours * 3600000).toISOString();
  let closed = 0;
  let scheduled = 0;
  let invalidHeld = 0;
  for (const a of attempts || []) {
    const key = a.key || `${a.advertiserId}|${a.productId}`;
    const prev = next.items[key] || {};
    const attemptCount = Number(prev.attemptCount || 0) + 1;
    if (a.status === ATTEMPT_STATUS.REFRESHED) {
      next.items[key] = {
        ...prev,
        key,
        advertiserId: a.advertiserId,
        productId: a.productId,
        status: ATTEMPT_STATUS.REFRESHED,
        attemptCount,
        lastAttemptAt: a.attemptedAt || nowIso,
        nextAttemptAt: null,
        closed: true,
        closedReason: "REFRESHED",
        apiResult: a.apiResult || null,
      };
      closed += 1;
      continue;
    }
    if (a.status === ATTEMPT_STATUS.INVALID_DATA) {
      next.items[key] = {
        ...prev,
        key,
        advertiserId: a.advertiserId,
        productId: a.productId,
        title: a.title || prev.title || null,
        feedId: a.feedId || prev.feedId || null,
        status: ATTEMPT_STATUS.INVALID_DATA,
        attemptCount,
        lastAttemptAt: a.attemptedAt || nowIso,
        nextAttemptAt: null,
        closed: true,
        closedReason: "IDENTITY_COLLISION_OR_INVALID_DATA",
        apiResult: a.apiResult || null,
        identityRepair: a.identityRepair || null,
        priorCauseCode: a.priorCauseCode || prev.priorCauseCode || null,
      };
      invalidHeld += 1;
      continue;
    }
    if (
      a.status === ATTEMPT_STATUS.PARTNERSHIP_ENDED ||
      a.status === ATTEMPT_STATUS.SOURCE_UNAVAILABLE
    ) {
      next.items[key] = {
        ...prev,
        key,
        advertiserId: a.advertiserId,
        productId: a.productId,
        status: a.status,
        attemptCount,
        lastAttemptAt: a.attemptedAt || nowIso,
        nextAttemptAt: null,
        closed: true,
        closedReason: a.status,
        apiResult: a.apiResult || null,
      };
      closed += 1;
      continue;
    }
    const exhausted = attemptCount >= maxAttempts;
    next.items[key] = {
      ...prev,
      key,
      advertiserId: a.advertiserId,
      productId: a.productId,
      title: a.title || prev.title || null,
      feedId: a.feedId || prev.feedId || null,
      status: exhausted ? ATTEMPT_STATUS.PRODUCT_NOT_FOUND : ATTEMPT_STATUS.RETRY_SCHEDULED,
      attemptCount,
      lastAttemptAt: a.attemptedAt || nowIso,
      nextAttemptAt: exhausted ? null : nextAttemptAt,
      closed: exhausted,
      closedReason: exhausted ? "MAX_RETRY_EXHAUSTED" : null,
      apiResult: a.apiResult || null,
      evidence: a.evidence || null,
      priorCauseCode: a.priorCauseCode || prev.priorCauseCode || null,
      lastVerifiedAt: a.priorLastVerifiedAt || prev.lastVerifiedAt || null,
      dataAgeHours: a.priorDataAgeHours ?? prev.dataAgeHours ?? null,
    };
    if (exhausted) closed += 1;
    else scheduled += 1;
  }
  next.counts = {
    open: Object.values(next.items).filter((x) => x && x.closed !== true).length,
    closed: Object.values(next.items).filter((x) => x && x.closed === true).length,
    scheduledThisPass: scheduled,
    closedThisPass: closed,
    invalidHeldThisPass: invalidHeld,
  };
  return next;
}

/**
 * Stamp nextCheckAt / attempt metadata onto products for RETRY / INVALID (no false publish).
 */
export function stampAttemptMetaOnDoc(doc, attempts, nowIso) {
  const byKey = new Map((attempts || []).map((a) => [a.key, a]));
  if (byKey.size === 0) return { doc, stamped: 0 };
  let stamped = 0;
  const sections = [];
  for (const sec of doc?.sections || []) {
    const products = [];
    for (const p of sec.products || []) {
      const key = String(p.advertiserId || "") + "|" + String(p.productId || "");
      const a = byKey.get(key);
      if (!a || a.status === ATTEMPT_STATUS.REFRESHED) {
        products.push(p);
        continue;
      }
      stamped += 1;
      const retryHours = DEFAULT_RETRY_HOURS;
      const nextCheckAt =
        a.status === ATTEMPT_STATUS.RETRY_SCHEDULED ||
        a.status === ATTEMPT_STATUS.TECHNICAL_FAILURE
          ? new Date(Date.parse(nowIso) + retryHours * 3600000).toISOString()
          : p.nextCheckAt || null;
      products.push({
        ...p,
        lastRefreshAttemptAt: a.attemptedAt || nowIso,
        lastRestoreAttempt: a.status,
        refreshAttemptStatus: a.status,
        refreshAttemptApiResult: a.apiResult || null,
        nextCheckAt,
        identityCollisionHold:
          a.status === ATTEMPT_STATUS.INVALID_DATA ? true : p.identityCollisionHold === true,
        publicationClass:
          a.status === ATTEMPT_STATUS.INVALID_DATA
            ? p.publicationClass || "IDENTITY_COLLISION"
            : p.publicationClass,
      });
    }
    sections.push({ ...sec, products });
  }
  return { doc: { ...doc, sections }, stamped };
}

/**
 * Run real productIds attempts for MISSING_REFRESH keys.
 * @returns {{ ledger, refreshedByKey, meta }}
 */
export async function attemptMissingRefreshBatch(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  const gqlEnv = opts.gqlEnv || null;
  const emptyApiByAdvertiser =
    opts.emptyApiByAdvertiser instanceof Set
      ? opts.emptyApiByAdvertiser
      : new Set(opts.emptyApiAdvertiserIds || []);
  const incompleteByAdvertiser =
    opts.incompleteByAdvertiser instanceof Set
      ? opts.incompleteByAdvertiser
      : new Set(opts.incompleteAdvertiserIds || []);
  const titleByKey = opts.titleByKey instanceof Map ? opts.titleByKey : new Map();
  for (const t of targets) {
    if (t.title && !titleByKey.has(t.key || `${t.advertiserId}|${t.productId}`)) {
      titleByKey.set(t.key || `${t.advertiserId}|${t.productId}`, t.title);
    }
  }
  const missKeys = targets.map((t) => ({
    advertiserId: String(t.advertiserId),
    productId: String(t.productId),
  }));
  const refreshedByKey = opts.refreshedByKey instanceof Map ? opts.refreshedByKey : new Map();
  const re = await reverifyMissProductsFromCj({
    missKeys,
    gqlEnv,
    websitePid: opts.websitePid || gqlEnv?.websitePid || "",
    refreshedByKey,
    matchedKeys: opts.matchedKeys instanceof Set ? opts.matchedKeys : new Set(refreshedByKey.keys()),
    nowIso,
    titleByKey,
    joinedAdvertiserIds: opts.joinedAdvertiserIds,
  });

  const byStatus = {};
  for (const s of Object.values(ATTEMPT_STATUS)) byStatus[s] = 0;
  const attempts = [];
  for (const t of targets) {
    const key = t.key || `${t.advertiserId}|${t.productId}`;
    const probe = re.probeByKey.get(key) || { recovered: false, apiResult: "no_probe_row" };
    const emptyApiPartner = emptyApiByAdvertiser.has(String(t.advertiserId));
    const incomplete = incompleteByAdvertiser.has(String(t.advertiserId));
    let status = classifyAttemptStatus(probe, {
      partnershipStatus: t.partnershipStatus,
      emptyApiPartner,
      forceRetry: incomplete && !probe.recovered,
    });
    // Incomplete partner + miss → schedule retry (continuation), not permanent not-found.
    if (
      incomplete &&
      !probe.recovered &&
      status === ATTEMPT_STATUS.PRODUCT_NOT_FOUND
    ) {
      status = ATTEMPT_STATUS.RETRY_SCHEDULED;
    }
    byStatus[status] = (byStatus[status] || 0) + 1;
    attempts.push({
      key,
      advertiserId: t.advertiserId,
      productId: t.productId,
      feedId: t.feedId || null,
      title: t.title || titleByKey.get(key) || null,
      priorCauseCode: t.causeCode || LKG_CAUSE.MISSING_REFRESH,
      priorLastVerifiedAt: t.lastVerifiedAt || null,
      priorDataAgeHours: t.dataAgeHours ?? null,
      attemptedAt: nowIso,
      apiResult: probe.apiResult || null,
      identityRepair: probe.identityRepair || null,
      status,
      evidence: {
        recovered: probe.recovered === true,
        emptyApiPartner,
        incompletePartner: incomplete,
        partnershipStatus: t.partnershipStatus || null,
      },
    });
  }

  const ledger = {
    schema: "iu-cj-affiliate-phase3z-lkg-missing-refresh-attempts-v51-8",
    at: nowIso,
    source: opts.source || null,
    runId: opts.runId || process.env.GITHUB_RUN_ID || null,
    targetCount: targets.length,
    byStatus,
    reverifyMeta: re.meta || null,
    credentialsPresent: Boolean(gqlEnv?.pat && gqlEnv?.publisherCid),
    attempts,
    note:
      "Every MISSING_REFRESH key listed was attempted via shoppingProducts(productIds) scoped + omitPartner reverify. Miss ≠ mass delete.",
  };
  return {
    ledger,
    refreshedByKey: re.refreshedByKey,
    matchedKeys: re.matchedKeys,
    meta: re.meta,
  };
}

/**
 * Apply successful attempts onto an offers doc (clear LKG on REFRESHED).
 * Local apply — avoids circular import with offers-live-sync.
 */
export function applyMissingRefreshAttemptsToDoc(doc, attemptResult, nowIso) {
  const refreshedByKey =
    attemptResult?.refreshedByKey instanceof Map
      ? attemptResult.refreshedByKey
      : new Map();
  const stamp = nowIso || new Date().toISOString();
  let merged = 0;
  let unchanged = 0;
  if (refreshedByKey.size === 0) {
    return {
      doc,
      stats: {
        merged: 0,
        unchanged: 0,
        attempted: attemptResult?.ledger?.targetCount || 0,
        refreshed: 0,
      },
    };
  }
  const sections = [];
  for (const sec of doc?.sections || []) {
    const products = [];
    for (const p of sec.products || []) {
      const key = String(p.advertiserId || "") + "|" + String(p.productId || "");
      const ref = refreshedByKey.get(key);
      if (!ref) {
        products.push(p);
        continue;
      }
      const out = mergeRefreshedProductIntoCard(p, ref, stamp);
      if (!out.changed) unchanged += 1;
      merged += 1;
      products.push({
        ...out.card,
        lkgCarried: false,
        lkgPublicHold: false,
        lkgHold: false,
        lastVerifiedAt: stamp,
        lastRefreshAttemptAt: stamp,
        refreshResult: REFRESH_RESULT.SUCCESSFULLY_REFRESHED,
        refreshReason: "missing_refresh_attempt_v51_8",
      });
    }
    sections.push({ ...sec, products });
  }
  return {
    doc: { ...doc, sections },
    stats: {
      merged,
      unchanged,
      attempted: attemptResult?.ledger?.targetCount || 0,
      refreshed: attemptResult?.ledger?.byStatus?.[ATTEMPT_STATUS.REFRESHED] || 0,
    },
  };
}

/**
 * Convenience: select + attempt + optional apply for a live offers doc.
 * Merges durable RETRY queue so RETRY_SCHEDULED survives restart / next schedule.
 */
export async function runMissingRefreshAttemptsOnOffersDoc(doc, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const selected = selectMissingRefreshTargets(doc, {
    nowMs,
    source: opts.source || null,
    includeHoldMissing: opts.includeHoldMissing === true,
    includeSourceTimestampCarry: opts.includeSourceTimestampCarry === true,
  });
  const priorQueue = opts.retryQueue || emptyRetryQueue(nowIso);
  const merged = mergeTargetsWithRetryQueue(selected.targets, priorQueue, { nowMs });
  const result = await attemptMissingRefreshBatch({
    targets: merged.targets,
    gqlEnv: opts.gqlEnv,
    websitePid: opts.websitePid,
    emptyApiAdvertiserIds: opts.emptyApiAdvertiserIds,
    incompleteAdvertiserIds: opts.incompleteAdvertiserIds,
    joinedAdvertiserIds: opts.joinedAdvertiserIds,
    runId: opts.runId,
    source: opts.source,
    nowIso,
    refreshedByKey: opts.refreshedByKey,
  });
  result.ledger.auditSummary = selected.auditSummary;
  result.ledger.queueMerge = {
    selectedOnly: merged.selectedOnly,
    dueFromQueue: merged.dueFromQueue,
    deferredNotDue: merged.deferredNotDue,
    attemptedUnique: merged.targets.length,
  };
  const nextQueue = updateRetryQueueFromAttempts(priorQueue, result.ledger.attempts, {
    nowIso,
    runId: opts.runId,
    retryHours: opts.retryHours,
    maxAttempts: opts.maxAttempts,
  });
  result.ledger.retryQueueCounts = nextQueue.counts || null;
  let nextDoc = doc;
  let applyStats = null;
  if (opts.applyToDoc === true) {
    const applied = applyMissingRefreshAttemptsToDoc(doc, result, nowIso);
    const stamped = stampAttemptMetaOnDoc(applied.doc, result.ledger.attempts, nowIso);
    nextDoc = stamped.doc;
    applyStats = { ...applied.stats, stampedMeta: stamped.stamped };
  }
  return {
    doc: nextDoc,
    ledger: result.ledger,
    refreshedByKey: result.refreshedByKey,
    meta: result.meta,
    applyStats,
    selectedCount: selected.targets.length,
    retryQueue: nextQueue,
  };
}

/**
 * Build a synthetic product row classification helper for offline tests.
 */
export function classifyProductAsMissingRefresh(p, sec, nowMs) {
  return classifyLkgProductFull(p, sec, nowMs);
}

async function main() {
  const url = process.env.IU_CJ_OFFERS_PUBLIC_URL || DEFAULT_URL;
  const outPath =
    process.env.IU_CJ_LKG_REFRESH_ATTEMPTS_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-lkg-missing-refresh-attempts-v51-8.json");
  const applyPath = process.env.IU_CJ_LKG_REFRESH_ATTEMPTS_APPLY_OUT || "";
  const dry =
    process.env.IU_CJ_LKG_REFRESH_ATTEMPTS_DRY === "1" ||
    !(process.env.IU_CJ_PAT || process.env.CJ_API_PAT || process.env.CJ_PERSONAL_ACCESS_TOKEN);

  const res = await fetch(url);
  const doc = await res.json();
  const gqlEnv = dry
    ? null
    : {
        pat: process.env.IU_CJ_PAT || process.env.CJ_API_PAT || process.env.CJ_PERSONAL_ACCESS_TOKEN || "",
        publisherCid: String(process.env.IU_CJ_PUBLISHER_CID || "").trim(),
        websitePid: String(process.env.IU_CJ_WEBSITE_PID || "101883843"),
      };

  const emptyIds = String(process.env.IU_CJ_EMPTY_API_ADVERTISER_IDS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const incompleteIds = String(process.env.IU_CJ_INCOMPLETE_ADVERTISER_IDS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const run = await runMissingRefreshAttemptsOnOffersDoc(doc, {
    gqlEnv: gqlEnv?.pat ? gqlEnv : null,
    websitePid: gqlEnv?.websitePid,
    emptyApiAdvertiserIds: emptyIds,
    incompleteAdvertiserIds: incompleteIds,
    source: url,
    applyToDoc: Boolean(applyPath),
    includeHoldMissing: process.env.IU_CJ_LKG_REFRESH_INCLUDE_HOLD === "1",
  });

  fs.writeFileSync(outPath, JSON.stringify(run.ledger, null, 2) + "\n", "utf8");
  if (applyPath) {
    fs.writeFileSync(applyPath, JSON.stringify(run.doc, null, 2) + "\n", "utf8");
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        dry,
        outPath,
        targetCount: run.ledger.targetCount,
        byStatus: run.ledger.byStatus,
        credentialsPresent: run.ledger.credentialsPresent,
        reverifyMeta: run.ledger.reverifyMeta,
        applyStats: run.applyStats,
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] &&
  process.argv[1]
    .replace(/\\/g, "/")
    .endsWith("iu-cj-affiliate-phase3z-lkg-missing-refresh-attempt-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
