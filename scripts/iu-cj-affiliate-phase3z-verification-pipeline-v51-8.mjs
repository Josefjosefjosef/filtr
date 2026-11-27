/**
 * V51.8 historical + live verification planner.
 * Extends the existing priority-refresh pipeline. No second robot.
 * Default mode is DISARMED_OFFLINE: no CJ network, no growth execute, no public JSON writes.
 * Title + price + URL is not a complete eligibility attestation.
 */
import fs from "node:fs";
import path from "node:path";
import { planAdaptiveBatch } from "./iu-cj-affiliate-phase3z-adaptive-growth-controller-v51-8.mjs";
import { scoreRefreshPriority } from "./iu-cj-affiliate-phase3z-source-current-priority-refresh-v51-8.mjs";

export const VERIFICATION_PIPELINE_SCHEMA = "iu-cj-affiliate-phase3z-verification-pipeline-v51-8";

export const VERIFICATION_STATE = Object.freeze({
  VERIFIED_ELIGIBLE: "VERIFIED_ELIGIBLE",
  DEFERRED_CANDIDATE_UNVERIFIED: "DEFERRED_CANDIDATE_UNVERIFIED",
  PENDING_REFRESH: "PENDING_REFRESH",
  MARKET_ELIGIBILITY_UNKNOWN: "MARKET_ELIGIBILITY_UNKNOWN",
  CONFIRMED_UNAVAILABLE: "CONFIRMED_UNAVAILABLE",
  INVALID_DATA: "INVALID_DATA",
  SOURCE_MISSING: "SOURCE_MISSING",
  IDENTITY_COLLISION: "IDENTITY_COLLISION",
  PARTNER_NOT_JOINED: "PARTNER_NOT_JOINED",
});

export const PIPELINE_MODE = Object.freeze({
  DISARMED_OFFLINE: "DISARMED_OFFLINE",
});

const TERMINAL = new Set([
  VERIFICATION_STATE.VERIFIED_ELIGIBLE,
  VERIFICATION_STATE.CONFIRMED_UNAVAILABLE,
  VERIFICATION_STATE.INVALID_DATA,
  VERIFICATION_STATE.PARTNER_NOT_JOINED,
  VERIFICATION_STATE.IDENTITY_COLLISION,
]);

const UNAVAILABLE = new Set(["OUT_OF_STOCK", "DISCONTINUED", "NOT_AVAILABLE"]);
const AVAILABILITY_OK = new Set(["IN_STOCK", "AVAILABLE", "BACKORDER", "PREORDER"]);

function availabilityIsNegated(value) {
  return /NOT[\s-]+(?:IN[\s-]+STOCK|AVAILABLE)|UNAVAILABLE|OUT[\s-]+OF[\s-]+STOCK|NENI\s+SKLADEM|NENÍ\s+SKLADEM/.test(String(value || ""));
}

function availabilityIsMissing(value) {
  return !value || value === "UNKNOWN" || value === "UNKNOWN_NULL" || value === "UNRECOGNIZED";
}

export function compositeIdentity(row) {
  const rawKey = row && row.key != null ? String(row.key) : "";
  const splitAt = rawKey.indexOf("|");
  const advertiserId = String(
    (row && row.advertiserId != null ? row.advertiserId : splitAt >= 0 ? rawKey.slice(0, splitAt) : "")
  ).trim();
  const productId = String(
    (row && row.productId != null ? row.productId : splitAt >= 0 ? rawKey.slice(splitAt + 1) : "")
  ).trim();
  const variant = String((row && row.productVariant) || "").trim();
  const base = advertiserId + "|" + productId;
  return { advertiserId, productId, productVariant: variant, key: variant ? base + "|" + variant : base };
}

/**
 * Deduplicate overlapping identity groups. Unique count is never the sum of the groups.
 */
export function dedupeVerificationGroups(groups) {
  const byKey = new Map();
  let inputRows = 0;
  const bySource = {};
  for (const group of groups || []) {
    const source = String(group && group.source ? group.source : "unknown");
    const priority = Number(group && group.priority) || 0;
    bySource[source] = 0;
    for (const row of (group && group.identities) || []) {
      inputRows += 1;
      bySource[source] += 1;
      const id = compositeIdentity(row);
      if (!id.advertiserId || !id.productId) continue;
      let cur = byKey.get(id.key);
      if (!cur) {
        cur = {
          advertiserId: id.advertiserId,
          productId: id.productId,
          productVariant: id.productVariant,
          key: id.key,
          sources: [],
          priority,
          localRecord: null,
        };
        byKey.set(id.key, cur);
      }
      if (!cur.sources.includes(source)) cur.sources.push(source);
      if (priority > cur.priority) cur.priority = priority;
      if (row && row.localRecord && !cur.localRecord) cur.localRecord = row.localRecord;
    }
  }
  return {
    inputRows,
    uniqueIdentities: byKey.size,
    duplicateRowsDropped: inputRows - byKey.size,
    bySource,
    identities: [...byKey.values()].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)),
  };
}

export function hashUnit(key) {
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function nextAttemptAt(attempt, nowMs, key) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const base = Math.min(3600000, 1000 * 2 ** Math.min(n, 8));
  const jitter = Math.floor(hashUnit(key) * base * 0.2);
  return nowMs + base + jitter;
}

function httpsUrl(value) {
  return /^https:\/\//i.test(String(value || "").trim());
}

/**
 * Attest one identity from a caller-supplied source record.
 * Missing sourceUpdatedAt stays missing. Currency, BACKORDER and PREORDER do not auto-invalidate.
 */
export function attestEligibility(identity, ctx = {}) {
  const id = compositeIdentity(identity || {});
  const nowMs = ctx.nowMs != null ? Number(ctx.nowMs) : Date.now();
  const base = {
    key: id.key,
    advertiserId: id.advertiserId,
    productId: id.productId,
    productVariant: id.productVariant,
    verifiedEligible: false,
    mode: PIPELINE_MODE.DISARMED_OFFLINE,
    attestedAt: new Date(nowMs).toISOString(),
    secondaryFlags: [],
    missing: [],
  };
  if (!id.advertiserId || !id.productId) {
    return { ...base, state: VERIFICATION_STATE.INVALID_DATA, reason: "IDENTITY_INCOMPLETE", retry: false };
  }
  if (ctx.identityCollision === true) {
    return { ...base, state: VERIFICATION_STATE.IDENTITY_COLLISION, reason: "IDENTITY_COLLISION", retry: false };
  }
  const relationship = String(ctx.relationship || "").toLowerCase();
  if (relationship !== "joined") {
    return {
      ...base,
      state: VERIFICATION_STATE.PARTNER_NOT_JOINED,
      reason: relationship ? "RELATIONSHIP_" + relationship.toUpperCase() : "RELATIONSHIP_ABSENT",
      retry: false,
    };
  }
  const rec = ctx.sourceRecord || null;
  if (!rec) {
    return { ...base, state: VERIFICATION_STATE.SOURCE_MISSING, reason: "AUTHORITATIVE_SOURCE_ABSENT", retry: true };
  }
  const availability = String(rec.availability || rec.availabilityClass || "").toUpperCase();
  if (UNAVAILABLE.has(availability) || availabilityIsNegated(availability)) {
    return {
      ...base,
      state: VERIFICATION_STATE.CONFIRMED_UNAVAILABLE,
      reason: "AVAILABILITY_" + (availability || "MISSING"),
      retry: false,
    };
  }
  if (availability === "BACKORDER" || availability === "PREORDER") {
    base.secondaryFlags.push("availability:" + availability);
  } else if (availability && !AVAILABILITY_OK.has(availability)) {
    base.secondaryFlags.push("availability:" + availability);
  }
  const currency = String(rec.currency || "").toUpperCase();
  if (currency && currency !== "CZK") base.secondaryFlags.push("currencyNotPreferred");
  const missing = [];
  if (!String(rec.title || "").trim()) missing.push("title");
  if (!String(rec.description || "").trim()) missing.push("description");
  if (!(Number(rec.currentPrice) > 0)) missing.push("currentPrice");
  if (!currency) missing.push("currency");
  if (!httpsUrl(rec.affiliateUrl)) missing.push("affiliateUrl");
  if (!httpsUrl(rec.imageUrl)) missing.push("imageUrl");
  if (!String(rec.language || "").trim()) missing.push("language");
  if (!String(rec.sectionId || "").trim()) missing.push("sectionId");
  if (availabilityIsMissing(availability)) missing.push("availability");
  if (ctx.termsAccepted !== true) missing.push("terms");
  if (missing.length) {
    return {
      ...base,
      state: VERIFICATION_STATE.DEFERRED_CANDIDATE_UNVERIFIED,
      reason: "PUBLICATION_CONDITIONS_INCOMPLETE",
      missing,
      retry: true,
    };
  }
  if (ctx.czEligible !== true) {
    return {
      ...base,
      state: VERIFICATION_STATE.MARKET_ELIGIBILITY_UNKNOWN,
      reason: "CZ_MARKET_NOT_ATTESTED",
      retry: true,
    };
  }
  const sourceUpdatedAt = rec.sourceUpdatedAt ? String(rec.sourceUpdatedAt) : null;
  if (!sourceUpdatedAt) {
    return {
      ...base,
      state: VERIFICATION_STATE.PENDING_REFRESH,
      reason: "AUTHORITATIVE_SOURCE_UPDATED_AT_ABSENT",
      freshnessStatus: "FETCH_RECENT_SOURCE_AGE_UNKNOWN",
      sourceUpdatedAt: null,
      retry: true,
    };
  }
  return {
    ...base,
    state: VERIFICATION_STATE.VERIFIED_ELIGIBLE,
    verifiedEligible: true,
    reason: "ALL_REQUIRED_PUBLICATION_CONDITIONS",
    freshnessStatus: "SOURCE_UPDATED_AT_PROVIDED",
    sourceUpdatedAt,
    retry: false,
  };
}

export function emptyCheckpoint(nowMs) {
  return {
    schema: VERIFICATION_PIPELINE_SCHEMA,
    mode: PIPELINE_MODE.DISARMED_OFFLINE,
    generation: 0,
    cursor: 0,
    createdAt: new Date(nowMs).toISOString(),
    completed: {},
    attempts: {},
    nextAttemptAt: {},
    partnerFailures: {},
    circuitOpen: {},
  };
}

export function planFairBatch(identities, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const limit = Math.max(1, Math.floor(Number(opts.limit) || 25));
  const maxPerPartner = Math.max(1, Math.floor(Number(opts.maxPerPartner) || 3));
  const failureLimit = Math.max(1, Math.floor(Number(opts.partnerFailureLimit) || 3));
  const checkpoint = opts.checkpoint || emptyCheckpoint(nowMs);
  const byPartner = new Map();
  for (const row of identities || []) {
    const done = checkpoint.completed && checkpoint.completed[row.key];
    if (done && TERMINAL.has(done.state)) continue;
    const due = checkpoint.nextAttemptAt && checkpoint.nextAttemptAt[row.key];
    if (due != null && Number(due) > nowMs) continue;
    if (checkpoint.circuitOpen && checkpoint.circuitOpen[row.advertiserId] === true) continue;
    const fails = Number(checkpoint.partnerFailures && checkpoint.partnerFailures[row.advertiserId]) || 0;
    if (fails >= failureLimit) continue;
    if (!byPartner.has(row.advertiserId)) byPartner.set(row.advertiserId, []);
    byPartner.get(row.advertiserId).push(row);
  }
  const partners = [...byPartner.keys()].sort();
  const batch = [];
  const taken = {};
  let guard = 0;
  while (batch.length < limit && guard < limit * Math.max(partners.length, 1) + 5) {
    guard += 1;
    let progressed = false;
    for (const partner of partners) {
      if (batch.length >= limit) break;
      const used = taken[partner] || 0;
      if (used >= maxPerPartner) continue;
      const queue = byPartner.get(partner) || [];
      if (!queue.length) continue;
      batch.push(queue.shift());
      taken[partner] = used + 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return {
    batch,
    partnersConsidered: partners.length,
    skippedByCircuit: Object.values(checkpoint.circuitOpen || {}).filter(Boolean).length,
    fair: true,
  };
}

/** Dedup historical deferred identities with pending hold identities. Does not read CJ or arm growth. */
export function planHistoricalVerificationQueue(input = {}, opts = {}) {
  const deferred = Array.isArray(input.deferred) ? input.deferred : [];
  const hold = Array.isArray(input.hold) ? input.hold : [];
  const byKey = new Map();
  let overlap = 0;
  for (const row of deferred) {
    if (!row || typeof row.key !== "string" || !row.key) continue;
    byKey.set(row.key, { ...row, queueSource: "DEFERRED" });
  }
  for (const row of hold) {
    if (!row || typeof row.key !== "string" || !row.key) continue;
    if (byKey.has(row.key)) {
      overlap += 1;
      const prev = byKey.get(row.key);
      byKey.set(row.key, {
        ...prev,
        queueSource: "DEFERRED_AND_HOLD",
        holdState: row.holdState || row.state || null,
      });
    } else {
      byKey.set(row.key, { ...row, queueSource: "HOLD" });
    }
  }
  const identities = [...byKey.values()];
  const checkpoint = opts.checkpoint || emptyCheckpoint(opts.nowMs != null ? Number(opts.nowMs) : Date.now());
  let completedInQueue = 0;
  for (const row of identities) {
    const done = checkpoint.completed && checkpoint.completed[row.key];
    if (done && TERMINAL.has(done.state)) completedInQueue += 1;
  }
  const planned = planFairBatch(identities, { ...opts, checkpoint });
  return {
    unique: identities.length,
    overlap,
    debt: identities.length - completedInQueue,
    completed: completedInQueue,
    batch: planned.batch,
    partnersConsidered: planned.partnersConsidered,
    growthExecute: "DISARMED",
    executeArmed: false,
    publicationExecute: false,
  };
}

function writeCheckpointAtomic(outPath, checkpoint, expectedGeneration) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(outPath)) {
    const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (expectedGeneration != null && Number(prev.generation) !== Number(expectedGeneration)) {
      const err = new Error("STALE_CHECKPOINT");
      err.code = "STALE_CHECKPOINT";
      throw err;
    }
  }
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, outPath);
}

export function loadCheckpoint(outPath) {
  if (!outPath || !fs.existsSync(outPath)) return null;
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
}

/**
 * SOURCE_READ uses the same credential gate as refreshPublishedProductsFromCj.
 * Growth execute and publication stay disarmed even when a read is authorized.
 * Missing local env is SKIPPED_NO_CREDENTIALS, not an HTTP failure and not a growth gate.
 */
export function diagnoseSourceReadAccess(env = process.env) {
  const patNames = ["IU_CJ_PAT", "CJ_API_PAT", "CJ_PERSONAL_ACCESS_TOKEN"];
  const patName = patNames.find((name) => String(env[name] || "").trim() !== "") || null;
  const publisherPresent = String(env.IU_CJ_PUBLISHER_CID || "").trim() !== "";
  const missing = [];
  if (!patName) missing.push("IU_CJ_PAT|CJ_API_PAT|CJ_PERSONAL_ACCESS_TOKEN");
  if (!publisherPresent) missing.push("IU_CJ_PUBLISHER_CID");
  return {
    operation: "SOURCE_READ",
    sourceRead: missing.length === 0,
    reason: missing.length === 0 ? "AUTHORIZED_SOURCE_READ_SAME_AS_REFRESH" : "SKIPPED_NO_CREDENTIALS",
    missing,
    patEnvName: patName,
    sameCondition: "!pat || !publisherCid",
    sameFunction: "refreshPublishedProductsFromCj",
    sameFile: "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs",
    growthExecute: "DISARMED",
    publicationExecute: false,
    productionActivation: false,
    httpStatus: null,
    notGrowthGate: true,
  };
}

function sourceRecordFromCjRow(row) {
  if (!row || typeof row !== "object") return null;
  const price = row.price && typeof row.price === "object" ? row.price.amount : row.price;
  return {
    title: row.title || row.name || null,
    description: row.description || null,
    currentPrice: price != null ? Number(price) : null,
    currency: (row.price && row.price.currency) || row.currency || null,
    availability: row.availability || row.advertiserAvailability || null,
    affiliateUrl: row.link || row.clickUrl || row.buyUrl || null,
    imageUrl: row.imageUrl || row.imageLink || null,
    language: row.language || null,
    sectionId: row.sectionId || null,
    sourceUpdatedAt: row.lastUpdated || row.sourceUpdatedAt || null,
    productId: row.id || row.productId || null,
    productVariant: row.productVariant || null,
  };
}

/**
 * Bounded read through the existing product-id fetch. Default cap is 4 identities.
 * confirmSourceRead must be true. Injected fetchProducts is for tests; production uses
 * fetchShoppingProductsByProductIds from the existing product API module.
 */
export async function runAuthorizedSourceLookup(opts = {}) {
  const env = opts.env || process.env;
  const access = diagnoseSourceReadAccess(env);
  const cap = Math.max(1, Math.min(8, Number(opts.maxIdentities) || 4));
  const identities = (opts.identities || []).slice(0, cap);
  if (!access.sourceRead) {
    return {
      ...access,
      refused: true,
      liveHttp: false,
      identitiesAttempted: 0,
      results: [],
      growth: { allowed: 0, reason: "OWNER_GATES_DISARMED", selected: [] },
    };
  }
  if (opts.confirmSourceRead !== true) {
    return {
      ...access,
      refused: true,
      reason: "SOURCE_READ_NOT_CONFIRMED",
      liveHttp: false,
      identitiesAttempted: 0,
      results: [],
      growth: { allowed: 0, reason: "OWNER_GATES_DISARMED", selected: [] },
    };
  }
  const byPartner = new Map();
  for (const item of identities) {
    const id = compositeIdentity(item);
    if (!byPartner.has(id.advertiserId)) byPartner.set(id.advertiserId, []);
    byPartner.get(id.advertiserId).push(id);
  }
  const partnerCap = Math.max(1, Math.min(2, Number(opts.maxPartners) || 1));
  const partners = [...byPartner.keys()].sort().slice(0, partnerCap);
  const fetchProducts =
    typeof opts.fetchProducts === "function"
      ? opts.fetchProducts
      : async (gqlEnv, advertiserId, ids) => {
          const api = await import("./iu-cj-affiliate-phase2-product-api.mjs");
          return api.fetchShoppingProductsByProductIds(gqlEnv, advertiserId, ids, {
            batchSize: Math.min(8, ids.length || 1),
          });
        };
  const patName = access.patEnvName;
  const gqlEnv = {
    pat: String(env[patName] || ""),
    publisherCid: String(env.IU_CJ_PUBLISHER_CID || "").trim(),
    websitePid: String(env.IU_CJ_WEBSITE_PID || ""),
  };
  const results = [];
  let httpStatus = null;
  for (const advertiserId of partners) {
    const ids = byPartner.get(advertiserId).map((row) => row.productId);
    let fetched = null;
    try {
      fetched = await fetchProducts(gqlEnv, advertiserId, ids);
    } catch (err) {
      const status = Number(err && (err.status || err.statusCode)) || null;
      httpStatus = status;
      for (const row of byPartner.get(advertiserId)) {
        results.push({
          ...attestEligibility(row, { relationship: "joined", sourceRecord: null, nowMs: opts.nowMs }),
          lookupError: status ? "HTTP_" + status : "LOOKUP_THROW",
        });
      }
      continue;
    }
    const kind = String(fetched && (fetched.kind || fetched.error) || "");
    if (/401/.test(kind)) httpStatus = 401;
    else if (/403/.test(kind)) httpStatus = 403;
    else if (/429/.test(kind)) httpStatus = 429;
    const byId = new Map();
    for (const row of (fetched && fetched.resultList) || []) {
      const rec = sourceRecordFromCjRow(row);
      if (!rec || !rec.productId) continue;
      const variant = String(rec.productVariant || "").trim();
      byId.set(variant ? String(rec.productId) + "|" + variant : String(rec.productId), rec);
    }
    for (const row of byPartner.get(advertiserId)) {
      const variant = String(row.productVariant || "").trim();
      const rec = byId.get(variant ? row.productId + "|" + variant : row.productId) || null;
      results.push(
        attestEligibility(row, {
          relationship: opts.relationship || "joined",
          sourceRecord: rec,
          czEligible: opts.czEligible,
          termsAccepted: opts.termsAccepted,
          nowMs: opts.nowMs,
        })
      );
    }
  }
  const verifiedQueue = results
    .filter((row) => row.verifiedEligible === true)
    .map((row) => ({
      key: row.key,
      verifiedEligible: true,
      verificationState: VERIFICATION_STATE.VERIFIED_ELIGIBLE,
    }));
  return {
    ...access,
    refused: false,
    liveHttp: typeof opts.fetchProducts !== "function",
    httpStatus,
    identitiesAttempted: results.length,
    results,
    verifiedEligible: verifiedQueue.length,
    growth: planAdaptiveBatch({
      candidates: verifiedQueue,
      health: { ok: true, stop: false, throttle: false },
      remainingCumulative: 0,
      uncappedGate: false,
      executeArmed: false,
    }),
  };
}

/**
 * Isolated batch. Local records do not perform HTTP.
 * Authorized CJ reads go through runAuthorizedSourceLookup, not through a growth gate.
 */
export function runVerificationBatch(opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const checkpoint = opts.checkpoint || emptyCheckpoint(nowMs);
  const plan = planFairBatch(opts.identities || [], {
    nowMs,
    limit: opts.limit,
    maxPerPartner: opts.maxPerPartner,
    partnerFailureLimit: opts.partnerFailureLimit,
    checkpoint,
  });
  const results = [];
  let verifiedEligible = 0;
  let ineligible = 0;
  let retry = 0;
  for (const item of plan.batch) {
    const sourceRecord =
      (typeof opts.lookup === "function" ? opts.lookup(item) : null) || item.localRecord || null;
    const relationship =
      opts.relationships && opts.relationships[item.advertiserId] != null
        ? opts.relationships[item.advertiserId]
        : opts.relationship || "";
    const attested = attestEligibility(item, {
      sourceRecord,
      relationship,
      czEligible: opts.czByAdvertiser ? opts.czByAdvertiser[item.advertiserId] : opts.czEligible,
      termsAccepted: opts.termsAccepted,
      identityCollision: opts.collisions && opts.collisions[item.key] === true,
      nowMs,
    });
    const prevAttempts = Number(checkpoint.attempts[item.key] || 0);
    checkpoint.attempts[item.key] = prevAttempts + 1;
    checkpoint.completed[item.key] = {
      state: attested.state,
      reason: attested.reason,
      at: attested.attestedAt,
      verifiedEligible: attested.verifiedEligible === true,
    };
    if (attested.retry) {
      retry += 1;
      checkpoint.nextAttemptAt[item.key] = nextAttemptAt(checkpoint.attempts[item.key], nowMs, item.key);
      if (attested.state === VERIFICATION_STATE.SOURCE_MISSING) {
        checkpoint.partnerFailures[item.advertiserId] =
          Number(checkpoint.partnerFailures[item.advertiserId] || 0) + 1;
        const limit = Math.max(1, Math.floor(Number(opts.partnerFailureLimit) || 3));
        if (checkpoint.partnerFailures[item.advertiserId] >= limit) {
          checkpoint.circuitOpen[item.advertiserId] = true;
        }
      }
    } else {
      checkpoint.nextAttemptAt[item.key] = null;
    }
    if (attested.verifiedEligible) verifiedEligible += 1;
    else ineligible += 1;
    results.push(attested);
  }
  checkpoint.generation = Number(checkpoint.generation || 0) + 1;
  checkpoint.updatedAt = new Date(nowMs).toISOString();
  checkpoint.cursor = Number(checkpoint.cursor || 0) + results.length;
  if (opts.outPath) writeCheckpointAtomic(opts.outPath, checkpoint, opts.expectedGeneration);
  const uniqueAttempts = Object.keys(checkpoint.completed).length;
  const debt = (opts.identities || []).filter((row) => {
    const done = checkpoint.completed[row.key];
    return !done || !TERMINAL.has(done.state);
  }).length;
  const verifiedQueue = results
    .filter((row) => row.verifiedEligible === true)
    .map((row) => ({
      key: row.key,
      verifiedEligible: true,
      verificationState: VERIFICATION_STATE.VERIFIED_ELIGIBLE,
    }));
  const growth = planAdaptiveBatch({
    candidates: verifiedQueue,
    health: { ok: true, stop: false, throttle: false },
    remainingCumulative: opts.remainingCumulative != null ? opts.remainingCumulative : 0,
    uncappedGate: false,
    executeArmed: false,
  });
  return {
    schema: VERIFICATION_PIPELINE_SCHEMA,
    mode: PIPELINE_MODE.DISARMED_OFFLINE,
    growthExecute: "DISARMED",
    publicGrowthUncapped: 0,
    results,
    checkpoint,
    growth,
    refreshHint: results.map((row) => ({
      key: row.key,
      tier: row.state === VERIFICATION_STATE.PENDING_REFRESH ? "P2_UNVERIFIED" : null,
    })),
    metrics: {
      batchSize: results.length,
      uniqueAttempts,
      verifiedEligible,
      ineligible,
      retry,
      verificationDebt: debt,
      attemptsAreNotUniqueVerified: true,
      partnersInBatch: new Set(results.map((row) => row.advertiserId)).size,
    },
  };
}

export function scoreKnownProduct(product, nowMs) {
  return scoreRefreshPriority(product, nowMs);
}
