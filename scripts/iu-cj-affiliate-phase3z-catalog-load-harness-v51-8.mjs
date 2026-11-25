#!/usr/bin/env node
/**
 * V51.8 — catalog load harness (CPU-only synthetic catalog + op timings).
 *
 * synthesizeCatalog builds an in-memory catalog shaped like section placements.
 * measureSyntheticOps times dedupe / shardEstimate / filterSim with NO I/O
 * and MUST NEVER touch projects/data.
 *
 * CLI selftest:
 *   node scripts/iu-cj-affiliate-phase3z-catalog-load-harness-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const CATALOG_LOAD_HARNESS_SCHEMA =
  "iu-cj-affiliate-phase3z-catalog-load-harness-v51-8";

const DEFAULT_SECTIONS = Object.freeze([
  "main",
  "seasonal",
  "promo",
  "partner",
]);

const BYTES_PER_PRODUCT_APPROX = 420;
const BYTES_PER_PLACEMENT_OVERHEAD = 48;
const SHARD_SIZE = 2500;

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("catalog-load-harness: invalid " + name + ": " + v);
  }
  return Math.trunc(n);
}

function sectionList(sections) {
  if (Array.isArray(sections) && sections.length > 0) {
    return sections.map((s) => String(s));
  }
  return [...DEFAULT_SECTIONS];
}

/**
 * Synthesize an in-memory catalog for load/timing experiments.
 * @param {{ uniqueProducts: number, sections?: string[] }} opts
 * @returns {{ unique: number, placements: object[], approxBytes: number }}
 */
export function synthesizeCatalog({ uniqueProducts, sections } = {}) {
  const unique = num(uniqueProducts, "uniqueProducts");
  const secs = sectionList(sections);
  const placements = [];

  for (let i = 0; i < unique; i++) {
    const productId = "syn-" + String(i).padStart(8, "0");
    const sectionKey = secs[i % secs.length];
    placements.push({
      productId,
      sectionKey,
      advertiserId: "adv-" + String(i % Math.max(1, Math.floor(unique / 50))),
      slot: i % 12,
      title: "Synthetic product " + productId,
    });
  }

  const approxBytes =
    unique * BYTES_PER_PRODUCT_APPROX + placements.length * BYTES_PER_PLACEMENT_OVERHEAD;

  return { unique, placements, approxBytes };
}

function timeMs(fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  return { ms, result };
}

/**
 * CPU-only synthetic ops on an in-memory catalog. No filesystem / network I/O.
 * @param {{ unique: number, placements: object[], approxBytes?: number }} catalog
 * @returns {{ dedupeMs: number, shardEstimateMs: number, filterSimMs: number, dedupeUnique: number, shardCount: number, filterKept: number }}
 */
export function measureSyntheticOps(catalog) {
  if (!catalog || !Array.isArray(catalog.placements)) {
    throw new Error("catalog-load-harness: catalog.placements required");
  }

  const dedupe = timeMs(() => {
    const seen = new Set();
    let uniqueCount = 0;
    for (const p of catalog.placements) {
      const id = p && p.productId != null ? String(p.productId) : "";
      if (!seen.has(id)) {
        seen.add(id);
        uniqueCount += 1;
      }
    }
    return uniqueCount;
  });

  const shard = timeMs(() => {
    const n = catalog.placements.length;
    return Math.max(1, Math.ceil(n / SHARD_SIZE));
  });

  const filter = timeMs(() => {
    let kept = 0;
    for (const p of catalog.placements) {
      if (!p) continue;
      if (p.slot != null && Number(p.slot) % 2 === 0) kept += 1;
    }
    return kept;
  });

  return {
    dedupeMs: dedupe.ms,
    shardEstimateMs: shard.ms,
    filterSimMs: filter.ms,
    dedupeUnique: dedupe.result,
    shardCount: shard.result,
    filterKept: filter.result,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

export function runCatalogLoadHarnessSelftest() {
  const sizes = [10000, 50000];
  const runs = [];

  for (const size of sizes) {
    const catalog = synthesizeCatalog({ uniqueProducts: size, sections: DEFAULT_SECTIONS });
    assert(catalog.unique === size, "unique matches for " + size);
    assert(catalog.placements.length === size, "placements length for " + size);
    assert(Number.isFinite(catalog.approxBytes) && catalog.approxBytes > 0, "approxBytes finite for " + size);

    const timings = measureSyntheticOps(catalog);
    assert(timings.dedupeUnique === size, "dedupe unique for " + size);
    assert(Number.isFinite(timings.dedupeMs), "dedupeMs finite for " + size);
    assert(Number.isFinite(timings.shardEstimateMs), "shardEstimateMs finite for " + size);
    assert(Number.isFinite(timings.filterSimMs), "filterSimMs finite for " + size);
    assert(Number.isFinite(timings.shardCount) && timings.shardCount >= 1, "shardCount for " + size);
    assert(Number.isFinite(timings.filterKept), "filterKept finite for " + size);

    runs.push({
      uniqueProducts: size,
      unique: catalog.unique,
      placements: catalog.placements.length,
      approxBytes: catalog.approxBytes,
      timings: {
        dedupeMs: timings.dedupeMs,
        shardEstimateMs: timings.shardEstimateMs,
        filterSimMs: timings.filterSimMs,
        dedupeUnique: timings.dedupeUnique,
        shardCount: timings.shardCount,
        filterKept: timings.filterKept,
      },
    });
  }

  return {
    schema: CATALOG_LOAD_HARNESS_SCHEMA + "-selftest",
    ok: true,
    wroteProjectsData: false,
    runs,
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runCatalogLoadHarnessSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_CATALOG_LOAD_HARNESS_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
