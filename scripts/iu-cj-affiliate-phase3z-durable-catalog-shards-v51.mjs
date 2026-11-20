#!/usr/bin/env node
/**
 * V51.8 — durable catalog git-tip sharding (HOLD/cold spill under GitHub 100MB).
 *
 * Tip stays under DURABLE_CATALOG_GIT_HARD_MAX_BYTES; cold/HOLD/BLOCKED rows spill
 * into deterministic shard files listed by the generation manifest on the tip.
 * Full identity set is restored via loadDurableCatalogFromDir before merge.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CATALOG_STATUS,
  PUBLICATION_ELIGIBILITY,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";
import {
  DURABLE_CATALOG_SCHEMA,
  DURABLE_CATALOG_REL,
  DURABLE_CATALOG_GIT_SOFT_MAX_BYTES,
  DURABLE_CATALOG_GIT_HARD_MAX_BYTES,
  compactDurableCatalogForGitTip,
  emptyDurableCatalog,
  normalizeDurableCatalogEntry,
  serializeDurableCatalog,
  summarizeDurableCatalog,
} from "./iu-cj-affiliate-phase3z-durable-catalog-v51.mjs";

export const DURABLE_CATALOG_SHARD_SCHEMA = "iu-cj-affiliate-phase3z-durable-catalog-shard-v51";
export const DURABLE_CATALOG_GENERATION_SCHEMA =
  "iu-cj-affiliate-phase3z-durable-catalog-generation-v51";
export const DURABLE_CATALOG_SHARD_FILE_PREFIX = "iu-affiliate-cj-durable-catalog-shard-v51-";
export const DURABLE_CATALOG_LKG_REL = "projects/data/iu-affiliate-cj-durable-catalog-lkg-v51.json";
export const DURABLE_CATALOG_LKG_SHARD_FILE_PREFIX =
  "iu-affiliate-cj-durable-catalog-lkg-shard-v51-";
/** Per-shard soft ceiling so workflow 99e6 gate never trips on a single shard. */
export const DURABLE_CATALOG_SHARD_SOFT_MAX_BYTES = 45_000_000;
/** Reserve tip budget for generation manifest + compactMeta after seal. */
export const DURABLE_CATALOG_GENERATION_HEADROOM_BYTES = 24_576;

export function sha256Hex(bufOrStr) {
  return createHash("sha256").update(bufOrStr).digest("hex");
}

export function shardFileName(shardId) {
  return `${DURABLE_CATALOG_SHARD_FILE_PREFIX}${shardId}.json`;
}

export function lkgShardFileName(shardId) {
  return `${DURABLE_CATALOG_LKG_SHARD_FILE_PREFIX}${shardId}.json`;
}

export function isColdSpillCandidate(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.catalogStatus === CATALOG_STATUS.CONFIRMED_REMOVED) return true;
  if (entry.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) return true;
  if (entry.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD) return true;
  if (entry.lkgPublicHold === true) return true;
  if (entry.publicOffer === false) return true;
  return false;
}

function productAgeMs(entry) {
  const ts =
    entry?.lastSourceMatchAt ||
    entry?.lastSuccessfulRefreshAt ||
    entry?.priceVerifiedAt ||
    entry?.updatedAt ||
    null;
  const ms = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function spillPriority(entry) {
  // Higher = spill first (coldest).
  if (entry?.catalogStatus === CATALOG_STATUS.CONFIRMED_REMOVED) return 300;
  if (entry?.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) return 200;
  if (
    entry?.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD ||
    entry?.lkgPublicHold === true
  )
    return 100;
  if (entry?.publicOffer === false) return 50;
  return 0;
}

export function rankSpillKeys(products) {
  const keys = Object.keys(products || {});
  keys.sort((a, b) => {
    const pa = products[a];
    const pb = products[b];
    const sa = spillPriority(pa);
    const sb = spillPriority(pb);
    if (sb !== sa) return sb - sa;
    const ageA = productAgeMs(pa);
    const ageB = productAgeMs(pb);
    if (ageA !== ageB) return ageA - ageB; // oldest first
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.filter((k) => isColdSpillCandidate(products[k]));
}

function cloneProducts(products) {
  const out = {};
  for (const [k, raw] of Object.entries(products || {})) {
    const n = normalizeDurableCatalogEntry(raw);
    if (n) out[k] = n;
  }
  return out;
}

/**
 * Serialize shard body without sha256 so hash is of canonical content.
 */
export function serializeShardBody(shardDoc) {
  const body = {
    schema: DURABLE_CATALOG_SHARD_SCHEMA,
    generation: shardDoc.generation,
    id: shardDoc.id,
    productCount: Object.keys(shardDoc.products || {}).length,
    products: shardDoc.products || {},
  };
  return JSON.stringify(body) + "\n";
}

export function sealShard(shardDoc) {
  const payloadWithoutHash = serializeShardBody(shardDoc);
  const sha256 = sha256Hex(payloadWithoutHash);
  const sealed = {
    schema: DURABLE_CATALOG_SHARD_SCHEMA,
    generation: shardDoc.generation,
    id: shardDoc.id,
    sha256,
    productCount: Object.keys(shardDoc.products || {}).length,
    products: shardDoc.products || {},
  };
  const payload = JSON.stringify(sealed) + "\n";
  return {
    doc: sealed,
    payload,
    bytes: Buffer.byteLength(payload, "utf8"),
    sha256,
  };
}

export function verifyShardIntegrity(shardDoc, opts = {}) {
  if (!shardDoc || typeof shardDoc !== "object") {
    return { ok: false, reason: "SHARD_MISSING_OR_INVALID" };
  }
  if (shardDoc.schema !== DURABLE_CATALOG_SHARD_SCHEMA) {
    return { ok: false, reason: "SHARD_SCHEMA_MISMATCH" };
  }
  if (!shardDoc.id || !shardDoc.sha256) {
    return { ok: false, reason: "SHARD_ID_OR_HASH_MISSING" };
  }
  if (opts.expectId != null && shardDoc.id !== opts.expectId) {
    return { ok: false, reason: "SHARD_ID_MISMATCH" };
  }
  if (opts.expectSha256 != null && shardDoc.sha256 !== opts.expectSha256) {
    return { ok: false, reason: "SHARD_MANIFEST_SHA_MISMATCH" };
  }
  if (opts.expectGeneration != null && shardDoc.generation !== opts.expectGeneration) {
    return { ok: false, reason: "SHARD_GENERATION_MISMATCH" };
  }
  const recomputed = sha256Hex(serializeShardBody(shardDoc));
  if (recomputed !== shardDoc.sha256) {
    return { ok: false, reason: "SHARD_CORRUPT_CONTENT_HASH", expected: shardDoc.sha256, actual: recomputed };
  }
  return { ok: true, sha256: recomputed, id: shardDoc.id };
}

function tipBytesForProducts(baseDoc, products) {
  const probe = {
    schema: DURABLE_CATALOG_SCHEMA,
    updatedAt: baseDoc.updatedAt,
    products,
    stats: baseDoc.stats || null,
    lastMerge: baseDoc.lastMerge || null,
  };
  if (baseDoc.compactMeta) probe.compactMeta = baseDoc.compactMeta;
  // Reserve headroom for generation manifest (~4–8KB typical).
  return Buffer.byteLength(serializeDurableCatalog(probe), "utf8");
}

/**
 * Pack cold keys into sealed shards under per-shard soft max.
 */
export function packColdProductsIntoShards(coldProducts, opts = {}) {
  const generation = Number(opts.generation) || 1;
  const shardSoftMax =
    Math.max(1_000_000, Number(opts.shardSoftMaxBytes) || DURABLE_CATALOG_SHARD_SOFT_MAX_BYTES);
  const keys = Object.keys(coldProducts || {}).sort();
  const shards = [];
  let cur = {};
  let curBytes = 0;
  let shardIndex = 0;

  function flush() {
    if (!Object.keys(cur).length) return;
    const id = "s" + String(shardIndex).padStart(4, "0");
    shardIndex += 1;
    const sealed = sealShard({ generation, id, products: cur });
    if (sealed.bytes > DURABLE_CATALOG_GIT_HARD_MAX_BYTES) {
      throw new Error(
        `DURABLE_SHARD_OVER_GITHUB_LIMIT id=${id} bytes=${sealed.bytes} hardMax=${DURABLE_CATALOG_GIT_HARD_MAX_BYTES}`
      );
    }
    shards.push(sealed);
    cur = {};
    curBytes = 0;
  }

  for (const key of keys) {
    const entry = coldProducts[key];
    const entryBytes = Buffer.byteLength(JSON.stringify({ [key]: entry }), "utf8") + 2;
    if (Object.keys(cur).length && curBytes + entryBytes > shardSoftMax) flush();
    cur[key] = entry;
    curBytes += entryBytes;
  }
  flush();
  return shards;
}

/**
 * Spill HOLD/cold rows from a compacting catalog until tip fits under hard (prefer soft).
 */
export function spillDurableCatalogToShards(fullDoc, opts = {}) {
  const softMax = Math.max(1, Number(opts.softMaxBytes) || DURABLE_CATALOG_GIT_SOFT_MAX_BYTES);
  const hardMax = Math.max(softMax, Number(opts.hardMaxBytes) || DURABLE_CATALOG_GIT_HARD_MAX_BYTES);
  const headroom = Math.max(
    1024,
    Number(opts.generationHeadroomBytes) || DURABLE_CATALOG_GENERATION_HEADROOM_BYTES
  );
  const tipHardBudget = Math.max(softMax, hardMax - headroom);
  const tipSoftBudget = Math.max(1, Math.min(softMax, tipHardBudget));
  const generation = Math.max(1, Number(opts.generation) || 1);
  const compacted = compactDurableCatalogForGitTip(fullDoc, { softMaxBytes: softMax, hardMaxBytes: hardMax });
  const products = cloneProducts(compacted.doc.products);
  const identityCount = Object.keys(products).length;

  if (compacted.ok && compacted.bytes <= tipSoftBudget) {
    return {
      ok: true,
      spilled: false,
      tipDoc: compacted.doc,
      tipPayload: compacted.payload,
      tipBytes: compacted.bytes,
      shards: [],
      generation,
      identityCount,
      tipIdentityCount: identityCount,
      shardIdentityCount: 0,
      compactActions: compacted.actions,
      reason: "UNDER_SOFT_NO_SPILL",
    };
  }

  const tipProducts = { ...products };
  const coldPool = {};
  const ranked = rankSpillKeys(tipProducts);
  let tipBytes = tipBytesForProducts(compacted.doc, tipProducts);
  const target = tipBytes > tipHardBudget ? tipHardBudget : tipSoftBudget;

  for (const key of ranked) {
    if (tipBytes <= target) break;
    coldPool[key] = tipProducts[key];
    delete tipProducts[key];
    tipBytes = tipBytesForProducts(compacted.doc, tipProducts);
  }

  // If still over tip budget after all cold spilled, fail closed (eligible-only tip too large).
  tipBytes = tipBytesForProducts(compacted.doc, tipProducts);
  if (tipBytes > tipHardBudget) {
    return {
      ok: false,
      spilled: Object.keys(coldPool).length > 0,
      tipDoc: null,
      tipPayload: null,
      tipBytes,
      shards: [],
      generation,
      identityCount,
      tipIdentityCount: Object.keys(tipProducts).length,
      shardIdentityCount: Object.keys(coldPool).length,
      reason: "TIP_ELIGIBLE_OVER_HARD_AFTER_SPILL",
      error: `DURABLE_CATALOG_TIP_OVER_HARD_AFTER_SPILL bytes=${tipBytes} tipHardBudget=${tipHardBudget} hardMax=${hardMax}`,
    };
  }

  // Collision guard: tip ∩ cold must be empty.
  for (const k of Object.keys(coldPool)) {
    if (Object.prototype.hasOwnProperty.call(tipProducts, k)) {
      return {
        ok: false,
        spilled: true,
        reason: "IDENTITY_COLLISION_TIP_SHARD",
        error: `IDENTITY_COLLISION_TIP_SHARD key=${k}`,
        tipDoc: null,
        shards: [],
        generation,
        identityCount,
      };
    }
  }

  const shards = packColdProductsIntoShards(coldPool, {
    generation,
    shardSoftMaxBytes: opts.shardSoftMaxBytes,
  });

  const tipDoc = {
    schema: DURABLE_CATALOG_SCHEMA,
    updatedAt: compacted.doc.updatedAt,
    products: tipProducts,
    stats: summarizeDurableCatalog({ products: { ...tipProducts, ...coldPool } }),
    lastMerge: compacted.doc.lastMerge || null,
  };
  // Re-compact tip (presentation strip) after spill.
  const tipCompact = compactDurableCatalogForGitTip(tipDoc, {
    softMaxBytes: tipSoftBudget,
    hardMaxBytes: tipHardBudget,
  });
  if (!tipCompact.ok || tipCompact.bytes > tipHardBudget) {
    return {
      ok: false,
      spilled: true,
      reason: "TIP_STILL_OVER_HARD_AFTER_COMPACT",
      error: `DURABLE_CATALOG_TIP_OVER_HARD bytes=${tipCompact.bytes} tipHardBudget=${tipHardBudget} hardMax=${hardMax}`,
      tipDoc: tipCompact.doc,
      tipBytes: tipCompact.bytes,
      shards,
      generation,
      identityCount,
      tipIdentityCount: Object.keys(tipCompact.doc.products || {}).length,
      shardIdentityCount: Object.keys(coldPool).length,
    };
  }

  return {
    ok: true,
    spilled: shards.length > 0,
    tipDoc: tipCompact.doc,
    tipPayload: tipCompact.payload,
    tipBytes: tipCompact.bytes,
    shards,
    generation,
    identityCount,
    tipIdentityCount: Object.keys(tipCompact.doc.products || {}).length,
    shardIdentityCount: Object.keys(coldPool).length,
    compactActions: tipCompact.actions,
    reason: shards.length ? "SPILLED_COLD_TO_SHARDS" : "UNDER_HARD_NO_SHARD_NEEDED",
  };
}

export function buildGenerationManifest({ generation, tipSha256, shards, priorGeneration, priorTipSha256, identityCount, tipIdentityCount, shardIdentityCount, spilledAt }) {
  return {
    schema: DURABLE_CATALOG_GENERATION_SCHEMA,
    generation: Number(generation),
    tipSha256: String(tipSha256 || ""),
    priorGeneration: priorGeneration == null ? null : Number(priorGeneration),
    priorTipSha256: priorTipSha256 == null ? null : String(priorTipSha256),
    identityCount: Number(identityCount) || 0,
    tipIdentityCount: Number(tipIdentityCount) || 0,
    shardIdentityCount: Number(shardIdentityCount) || 0,
    spilledAt: spilledAt || new Date().toISOString(),
    shards: (shards || []).map((s) => ({
      id: s.doc?.id || s.id,
      sha256: s.sha256 || s.doc?.sha256,
      bytes: s.bytes != null ? s.bytes : Buffer.byteLength(s.payload || "", "utf8"),
      productCount: s.doc?.productCount ?? Object.keys(s.doc?.products || s.products || {}).length,
      file: shardFileName(s.doc?.id || s.id),
    })),
  };
}

/**
 * Attach generation manifest + tip content hash. Tip sha covers products+stats (not generation.self).
 */
/** Content hash covers identity payload only (not volatile compactMeta.at). */
export function tipContentHashPayload(tipDoc) {
  return serializeDurableCatalog({
    schema: DURABLE_CATALOG_SCHEMA,
    updatedAt: tipDoc?.updatedAt || null,
    products: tipDoc?.products || {},
    stats: tipDoc?.stats || null,
    lastMerge: tipDoc?.lastMerge || null,
  });
}

export function sealTipWithGeneration(tipDoc, spillResult, opts = {}) {
  const generation = Number(opts.generation ?? spillResult.generation) || 1;
  const priorGeneration = opts.priorGeneration != null ? Number(opts.priorGeneration) : null;
  const priorTipSha256 = opts.priorTipSha256 || null;
  const base = {
    schema: DURABLE_CATALOG_SCHEMA,
    updatedAt: tipDoc.updatedAt,
    products: tipDoc.products || {},
    stats: tipDoc.stats || summarizeDurableCatalog(tipDoc),
    lastMerge: tipDoc.lastMerge || null,
  };
  if (tipDoc.compactMeta) base.compactMeta = tipDoc.compactMeta;
  const tipSha256 = sha256Hex(tipContentHashPayload(base));
  const generationManifest = buildGenerationManifest({
    generation,
    tipSha256,
    shards: spillResult.shards || [],
    priorGeneration,
    priorTipSha256,
    identityCount: spillResult.identityCount,
    tipIdentityCount: spillResult.tipIdentityCount ?? Object.keys(base.products).length,
    shardIdentityCount: spillResult.shardIdentityCount ?? 0,
    spilledAt: opts.spilledAt || new Date().toISOString(),
  });
  const sealed = { ...base, generation: generationManifest };
  const payload = serializeDurableCatalog(sealed);
  const bytes = Buffer.byteLength(payload, "utf8");
  return {
    doc: sealed,
    payload,
    bytes,
    tipSha256,
    generation: generationManifest,
    ok: bytes <= (Number(opts.hardMaxBytes) || DURABLE_CATALOG_GIT_HARD_MAX_BYTES),
  };
}

export function assertGenerationManifestIntegrity(tipDoc, shardDocsById = {}) {
  const gen = tipDoc?.generation;
  if (!gen || gen.schema !== DURABLE_CATALOG_GENERATION_SCHEMA) {
    // Legacy tip without generation — treat as single-blob, no shards required.
    if (!tipDoc?.generation) return { ok: true, legacy: true, reason: "LEGACY_TIP_NO_GENERATION" };
    return { ok: false, reason: "GENERATION_SCHEMA_MISMATCH" };
  }
  const listed = Array.isArray(gen.shards) ? gen.shards : [];
  const seenIds = new Set();
  for (const entry of listed) {
    if (!entry?.id || !entry?.sha256) return { ok: false, reason: "MANIFEST_SHARD_ENTRY_INCOMPLETE" };
    if (seenIds.has(entry.id)) return { ok: false, reason: "MANIFEST_DUPLICATE_SHARD_ID", id: entry.id };
    seenIds.add(entry.id);
    const shard = shardDocsById[entry.id];
    if (!shard) return { ok: false, reason: "MISSING_SHARD", id: entry.id };
    const v = verifyShardIntegrity(shard, {
      expectId: entry.id,
      expectSha256: entry.sha256,
      expectGeneration: gen.generation,
    });
    if (!v.ok) return { ok: false, reason: v.reason, id: entry.id, detail: v };
  }
  // Tip content hash check (products+stats+lastMerge; not compactMeta/generation).
  const recomputed = sha256Hex(tipContentHashPayload(tipDoc));
  if (gen.tipSha256 && recomputed !== gen.tipSha256) {
    return { ok: false, reason: "MANIFEST_TIP_SHA_MISMATCH", expected: gen.tipSha256, actual: recomputed };
  }
  return { ok: true, generation: gen.generation, shardCount: listed.length, tipSha256: recomputed };
}

/**
 * Deterministic restore of full product map from tip + shards.
 * Fail-closed on missing/corrupt shard or identity collision.
 */
export function restoreDurableCatalogFromTipAndShards(tipDoc, shardDocsById = {}) {
  const integrity = assertGenerationManifestIntegrity(tipDoc, shardDocsById);
  if (!integrity.ok) {
    return { ok: false, reason: integrity.reason, detail: integrity, doc: null };
  }
  const products = cloneProducts(tipDoc?.products || {});
  const collisions = [];
  const listed = tipDoc?.generation?.shards || [];
  for (const entry of listed) {
    const shard = shardDocsById[entry.id];
    for (const [k, raw] of Object.entries(shard.products || {})) {
      if (Object.prototype.hasOwnProperty.call(products, k)) {
        collisions.push(k);
        continue;
      }
      const n = normalizeDurableCatalogEntry(raw);
      if (n) products[k] = n;
    }
  }
  if (collisions.length) {
    return {
      ok: false,
      reason: "IDENTITY_COLLISION_ON_RESTORE",
      collisions: collisions.slice(0, 20),
      doc: null,
    };
  }
  const doc = emptyDurableCatalog(tipDoc?.updatedAt);
  doc.products = products;
  doc.stats = summarizeDurableCatalog(doc);
  doc.lastMerge = tipDoc?.lastMerge || null;
  if (tipDoc?.generation) doc.generation = tipDoc.generation;
  if (tipDoc?.compactMeta) doc.compactMeta = tipDoc.compactMeta;
  return {
    ok: true,
    doc,
    identityCount: Object.keys(products).length,
    tipIdentityCount: Object.keys(tipDoc?.products || {}).length,
    shardCount: listed.length,
    generation: tipDoc?.generation?.generation ?? null,
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listShardFiles(dataDir, prefix = DURABLE_CATALOG_SHARD_FILE_PREFIX) {
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
    .sort();
}

/**
 * Load tip (+shards via manifest). Fail-closed when shards missing/corrupt.
 */
export function loadDurableCatalogFromDir(dataDir, opts = {}) {
  const tipName = opts.tipFileName || path.basename(DURABLE_CATALOG_REL);
  const tipPath = path.join(dataDir, tipName);
  if (!fs.existsSync(tipPath)) {
    return { ok: false, reason: "TIP_MISSING", doc: null, tipPath };
  }
  let tipDoc;
  try {
    tipDoc = readJsonFile(tipPath);
  } catch (e) {
    return { ok: false, reason: "TIP_PARSE_ERROR", error: String(e), doc: null, tipPath };
  }
  const listed = tipDoc?.generation?.shards || [];
  if (!listed.length) {
    // Legacy or unsharded tip.
    return {
      ok: true,
      doc: tipDoc,
      tipPath,
      shardCount: 0,
      generation: tipDoc?.generation?.generation ?? null,
      legacy: !tipDoc?.generation,
    };
  }
  const shardDocsById = {};
  for (const entry of listed) {
    const file = entry.file || shardFileName(entry.id);
    const shardPath = path.join(dataDir, file);
    if (!fs.existsSync(shardPath)) {
      return { ok: false, reason: "MISSING_SHARD", id: entry.id, shardPath, doc: null };
    }
    let shardDoc;
    try {
      shardDoc = readJsonFile(shardPath);
    } catch (e) {
      return { ok: false, reason: "SHARD_PARSE_ERROR", id: entry.id, error: String(e), doc: null };
    }
    shardDocsById[entry.id] = shardDoc;
  }
  const restored = restoreDurableCatalogFromTipAndShards(tipDoc, shardDocsById);
  if (!restored.ok) {
    return { ...restored, tipPath };
  }
  return {
    ok: true,
    doc: restored.doc,
    tipPath,
    shardCount: restored.shardCount,
    generation: restored.generation,
    identityCount: restored.identityCount,
  };
}

function writeFileAtomic(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, filePath);
}

function clearFilesByPrefix(dataDir, prefix) {
  for (const name of listShardFiles(dataDir, prefix)) {
    try {
      fs.unlinkSync(path.join(dataDir, name));
    } catch {
      /* ignore */
    }
  }
}

function snapshotLkg(dataDir, tipDoc) {
  const tipPath = path.join(dataDir, path.basename(DURABLE_CATALOG_REL));
  const lkgTipPath = path.join(dataDir, path.basename(DURABLE_CATALOG_LKG_REL));
  if (fs.existsSync(tipPath)) {
    fs.copyFileSync(tipPath, lkgTipPath);
  }
  clearFilesByPrefix(dataDir, DURABLE_CATALOG_LKG_SHARD_FILE_PREFIX);
  const listed = tipDoc?.generation?.shards || [];
  for (const entry of listed) {
    const src = path.join(dataDir, entry.file || shardFileName(entry.id));
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dataDir, lkgShardFileName(entry.id));
    fs.copyFileSync(src, dest);
  }
}

/**
 * Atomic publish: spill if needed → write all shards → seal tip → refuse older generation.
 * Never throws DURABLE_CATALOG_OVER_GITHUB_LIMIT when spill succeeds under hard max.
 */
export function publishDurableCatalogAtomic(dataDir, fullDoc, opts = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tipPath = path.join(dataDir, path.basename(DURABLE_CATALOG_REL));
  let priorGeneration = 0;
  let priorTipSha256 = null;
  let priorTipDoc = null;
  if (fs.existsSync(tipPath)) {
    try {
      priorTipDoc = readJsonFile(tipPath);
      priorGeneration = Number(priorTipDoc?.generation?.generation) || 0;
      priorTipSha256 = priorTipDoc?.generation?.tipSha256 || null;
    } catch {
      priorGeneration = 0;
    }
  }

  const requestedGeneration =
    opts.generation != null ? Number(opts.generation) : priorGeneration + 1;
  if (requestedGeneration < priorGeneration) {
    return {
      ok: false,
      reason: "REFUSE_OVERWRITE_NEWER_GENERATION",
      priorGeneration,
      requestedGeneration,
      error: `REFUSE_OVERWRITE_NEWER_GENERATION prior=${priorGeneration} requested=${requestedGeneration}`,
    };
  }
  // Idempotent resume: same generation + same tip hash allowed; older content for same gen refused below after seal.

  const softMax = Number(opts.softMaxBytes) || DURABLE_CATALOG_GIT_SOFT_MAX_BYTES;
  const hardMax = Number(opts.hardMaxBytes) || DURABLE_CATALOG_GIT_HARD_MAX_BYTES;
  const spill = spillDurableCatalogToShards(fullDoc, {
    softMaxBytes: softMax,
    hardMaxBytes: hardMax,
    generation: requestedGeneration,
    shardSoftMaxBytes: opts.shardSoftMaxBytes,
    generationHeadroomBytes: opts.generationHeadroomBytes,
  });
  if (!spill.ok) {
    return {
      ok: false,
      reason: spill.reason || "SPILL_FAILED",
      error: spill.error || spill.reason,
      tipBytes: spill.tipBytes,
      shardCount: 0,
    };
  }

  const sealed = sealTipWithGeneration(spill.tipDoc, spill, {
    generation: requestedGeneration,
    priorGeneration: priorGeneration || null,
    priorTipSha256,
    hardMaxBytes: hardMax,
    spilledAt: opts.nowIso || new Date().toISOString(),
  });
  if (!sealed.ok) {
    return {
      ok: false,
      reason: "SEALED_TIP_OVER_HARD",
      error: `DURABLE_CATALOG_TIP_OVER_HARD bytes=${sealed.bytes} hardMax=${hardMax}`,
      tipBytes: sealed.bytes,
      shardCount: spill.shards.length,
    };
  }

  // Same-generation resume: if content identical, no-op success.
  if (
    requestedGeneration === priorGeneration &&
    priorTipSha256 &&
    sealed.tipSha256 === priorTipSha256
  ) {
    return {
      ok: true,
      resumed: true,
      generation: requestedGeneration,
      tipBytes: sealed.bytes,
      tipSha256: sealed.tipSha256,
      shardCount: spill.shards.length,
      spilled: spill.spilled,
      reason: "IDEMPOTENT_RESUME_SAME_GENERATION",
      path: tipPath,
    };
  }
  // Same generation but different content after a newer tip existed — refuse unless force.
  if (requestedGeneration === priorGeneration && priorTipSha256 && sealed.tipSha256 !== priorTipSha256) {
    if (opts.allowSameGenerationRewrite !== true) {
      return {
        ok: false,
        reason: "REFUSE_REWRITE_SAME_GENERATION_DIFFERENT_HASH",
        priorGeneration,
        priorTipSha256,
        tipSha256: sealed.tipSha256,
        error: "REFUSE_REWRITE_SAME_GENERATION_DIFFERENT_HASH",
      };
    }
  }

  // Snapshot LKG from prior tip before mutating (rollback target).
  if (priorTipDoc && opts.skipLkg !== true) {
    snapshotLkg(dataDir, priorTipDoc);
  }

  // Write shards first (no partial tip publish). Staging via atomic rename per file.
  const writtenShards = [];
  try {
    for (const s of spill.shards) {
      const file = path.join(dataDir, shardFileName(s.doc.id));
      writeFileAtomic(file, s.payload);
      const onDisk = fs.readFileSync(file);
      const diskSha = sha256Hex(serializeShardBody(JSON.parse(onDisk.toString("utf8"))));
      if (diskSha !== s.sha256) {
        throw new Error(`SHARD_WRITE_HASH_MISMATCH id=${s.doc.id}`);
      }
      writtenShards.push(file);
    }
    // Remove obsolete live shards not in this generation.
    const keep = new Set(spill.shards.map((s) => shardFileName(s.doc.id)));
    for (const name of listShardFiles(dataDir, DURABLE_CATALOG_SHARD_FILE_PREFIX)) {
      if (!keep.has(name)) {
        try {
          fs.unlinkSync(path.join(dataDir, name));
        } catch {
          /* ignore */
        }
      }
    }
    writeFileAtomic(tipPath, sealed.payload);
  } catch (e) {
    // Best-effort cleanup of shards written this attempt; leave LKG intact.
    for (const f of writtenShards) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      reason: "PARTIAL_PUBLISH_ABORTED",
      error: String(e && e.stack ? e.stack : e).slice(0, 500),
      tipBytes: sealed.bytes,
      shardCount: spill.shards.length,
    };
  }

  // Verify load-back integrity (no partial publish).
  const loaded = loadDurableCatalogFromDir(dataDir);
  if (!loaded.ok) {
    return {
      ok: false,
      reason: "POST_PUBLISH_LOAD_FAILED",
      error: loaded.reason,
      tipBytes: sealed.bytes,
      shardCount: spill.shards.length,
      detail: loaded,
    };
  }
  const expectedIds = spill.identityCount;
  const gotIds = Object.keys(loaded.doc?.products || {}).length;
  if (expectedIds != null && gotIds !== expectedIds) {
    return {
      ok: false,
      reason: "POST_PUBLISH_IDENTITY_COUNT_MISMATCH",
      expectedIds,
      gotIds,
      tipBytes: sealed.bytes,
      shardCount: spill.shards.length,
    };
  }

  return {
    ok: true,
    resumed: false,
    generation: requestedGeneration,
    tipBytes: sealed.bytes,
    tipSha256: sealed.tipSha256,
    shardCount: spill.shards.length,
    spilled: spill.spilled,
    identityCount: gotIds,
    tipIdentityCount: sealed.generation.tipIdentityCount,
    shardIdentityCount: sealed.generation.shardIdentityCount,
    reason: spill.reason,
    path: tipPath,
    softOk: sealed.bytes <= softMax,
    compactActions: spill.compactActions || [],
    generationManifest: sealed.generation,
  };
}

/**
 * Rollback tip (+shards) from LKG snapshot. Refuses if LKG missing/corrupt.
 */
export function rollbackDurableCatalogToLkg(dataDir, opts = {}) {
  const lkgTipPath = path.join(dataDir, path.basename(DURABLE_CATALOG_LKG_REL));
  if (!fs.existsSync(lkgTipPath)) {
    return { ok: false, reason: "LKG_MISSING" };
  }
  let lkgTip;
  try {
    lkgTip = readJsonFile(lkgTipPath);
  } catch (e) {
    return { ok: false, reason: "LKG_PARSE_ERROR", error: String(e) };
  }
  const listed = lkgTip?.generation?.shards || [];
  const shardDocsById = {};
  for (const entry of listed) {
    const lkgShardPath = path.join(dataDir, lkgShardFileName(entry.id));
    if (!fs.existsSync(lkgShardPath)) {
      return { ok: false, reason: "LKG_SHARD_MISSING", id: entry.id };
    }
    const shardDoc = readJsonFile(lkgShardPath);
    const v = verifyShardIntegrity(shardDoc, {
      expectId: entry.id,
      expectSha256: entry.sha256,
      expectGeneration: lkgTip.generation?.generation,
    });
    if (!v.ok) return { ok: false, reason: "LKG_SHARD_CORRUPT", id: entry.id, detail: v };
    shardDocsById[entry.id] = shardDoc;
  }
  const integrity = assertGenerationManifestIntegrity(lkgTip, shardDocsById);
  if (!integrity.ok && listed.length) {
    return { ok: false, reason: "LKG_MANIFEST_INTEGRITY_FAIL", detail: integrity };
  }

  // Restore live shards from LKG copies.
  clearFilesByPrefix(dataDir, DURABLE_CATALOG_SHARD_FILE_PREFIX);
  for (const entry of listed) {
    const src = path.join(dataDir, lkgShardFileName(entry.id));
    const dest = path.join(dataDir, shardFileName(entry.id));
    fs.copyFileSync(src, dest);
  }
  const tipPath = path.join(dataDir, path.basename(DURABLE_CATALOG_REL));
  writeFileAtomic(tipPath, serializeDurableCatalog(lkgTip));
  const loaded = loadDurableCatalogFromDir(dataDir);
  if (!loaded.ok) {
    return { ok: false, reason: "ROLLBACK_LOAD_FAILED", detail: loaded };
  }
  return {
    ok: true,
    generation: lkgTip?.generation?.generation ?? null,
    identityCount: Object.keys(loaded.doc?.products || {}).length,
    shardCount: listed.length,
    reason: opts.reason || "ROLLBACK_TO_LKG",
  };
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith(
    "iu-cj-affiliate-phase3z-durable-catalog-shards-v51.mjs"
  );
if (isMain) {
  console.log(
    JSON.stringify({
      IU_CJ_DURABLE_CATALOG_SHARDS_V51: "MODULE",
      shardSoftMax: DURABLE_CATALOG_SHARD_SOFT_MAX_BYTES,
      tipHardMax: DURABLE_CATALOG_GIT_HARD_MAX_BYTES,
    })
  );
}
