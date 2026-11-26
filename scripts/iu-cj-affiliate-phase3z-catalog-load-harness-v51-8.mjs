#!/usr/bin/env node
/**
 * V51.8 — catalog load harness (CPU-only synthetic catalog + op timings).
 *
 * synthesizeCatalog builds an in-memory catalog shaped like section placements.
 * measureSyntheticOps times dedupe / shardEstimate / filterSim with NO I/O
 * and MUST NEVER touch projects/data.
 *
 * C-LOAD-TESTS: isolated scale scenarios (1k .. 300k) with timing + memory
 * summary. OFFLINE ONLY: no network, no filesystem writes, no production
 * publish, no growth/email activation (DISARMED).
 *
 * CLI:
 *   node scripts/iu-cj-affiliate-phase3z-catalog-load-harness-v51-8.mjs
 *       selftest (CI-safe, default sizes 1k/5k; honors IU_CJ_LOAD_MAX)
 *   node scripts/iu-cj-affiliate-phase3z-catalog-load-harness-v51-8.mjs --scale
 *       scale scenarios up to IU_CJ_LOAD_MAX (default 10000), one child
 *       process per scenario (isolated heap / peak RSS)
 *   node scripts/iu-cj-affiliate-phase3z-catalog-load-harness-v51-8.mjs --scenario 100000
 *       single scenario in this process (used by --scale)
 *
 * Env:
 *   IU_CJ_LOAD_MAX   upper bound for scale tiers (default 10000 for --scale,
 *                    5000 for selftest). Tiers: 1k 5k 10k 25k 50k 100k 200k 300k.
 *                    Hard cap 1,000,000.
 *   Local 300k:  $env:IU_CJ_LOAD_MAX = "300000"
 *                node scripts/iu-cj-affiliate-phase3z-catalog-load-harness-v51-8.mjs --scale
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const CATALOG_LOAD_HARNESS_SCHEMA =
  "iu-cj-affiliate-phase3z-catalog-load-harness-v51-8";

export const LOAD_SCALE_TIERS = Object.freeze([1000, 5000, 10000, 25000, 50000, 100000, 200000, 300000]);
export const LOAD_DEFAULT_SELFTEST_MAX = 5000;
export const LOAD_DEFAULT_SCALE_MAX = 10000;
export const LOAD_HARD_CAP = 1000000;

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

function mb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/**
 * Resolve scale tiers <= max. Invalid / empty max falls back to defaultMax.
 * @param {number|string|undefined} maxRaw
 * @param {number} defaultMax
 * @returns {number[]}
 */
export function resolveScaleSizes(maxRaw, defaultMax = LOAD_DEFAULT_SCALE_MAX) {
  let max = defaultMax;
  if (maxRaw != null && String(maxRaw).trim() !== "") {
    const n = Number(maxRaw);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error("catalog-load-harness: invalid IU_CJ_LOAD_MAX: " + maxRaw);
    }
    max = Math.trunc(n);
  }
  if (max > LOAD_HARD_CAP) {
    throw new Error("catalog-load-harness: IU_CJ_LOAD_MAX exceeds hard cap " + LOAD_HARD_CAP);
  }
  const sizes = LOAD_SCALE_TIERS.filter((s) => s <= max);
  // Non-tier max (e.g. 20000) is appended as its own final scenario.
  if (sizes.length === 0 || sizes[sizes.length - 1] !== max) sizes.push(max);
  return sizes;
}

/**
 * Run ONE isolated scenario: fresh catalog, timings, memory summary.
 * Catalog is released at the end so scenarios do not accumulate in-process.
 * In-process memory numbers are heap deltas (best-effort; exact when run via
 * --scenario in its own child process, where peakRssMb is also per-scenario).
 * @param {number} size
 * @returns {object}
 */
export function runLoadScenario(size) {
  const unique = num(size, "size");
  if (unique > LOAD_HARD_CAP) {
    throw new Error("catalog-load-harness: size exceeds hard cap " + LOAD_HARD_CAP);
  }
  if (typeof globalThis.gc === "function") globalThis.gc();
  const memBefore = process.memoryUsage();

  const synth = timeMs(() => synthesizeCatalog({ uniqueProducts: unique, sections: DEFAULT_SECTIONS }));
  const catalog = synth.result;
  const memAfterSynth = process.memoryUsage();

  const timings = measureSyntheticOps(catalog);
  const memAfterOps = process.memoryUsage();

  const maxRssKb =
    typeof process.resourceUsage === "function" ? process.resourceUsage().maxRSS : 0;

  const result = {
    uniqueProducts: unique,
    unique: catalog.unique,
    placements: catalog.placements.length,
    approxBytes: catalog.approxBytes,
    synthesizeMs: synth.ms,
    timings: {
      dedupeMs: timings.dedupeMs,
      shardEstimateMs: timings.shardEstimateMs,
      filterSimMs: timings.filterSimMs,
      dedupeUnique: timings.dedupeUnique,
      shardCount: timings.shardCount,
      filterKept: timings.filterKept,
    },
    totalMs: synth.ms + timings.dedupeMs + timings.shardEstimateMs + timings.filterSimMs,
    memory: {
      heapUsedBeforeMb: mb(memBefore.heapUsed),
      heapUsedAfterSynthMb: mb(memAfterSynth.heapUsed),
      heapUsedAfterOpsMb: mb(memAfterOps.heapUsed),
      heapDeltaMb: mb(memAfterOps.heapUsed - memBefore.heapUsed),
      rssAfterOpsMb: mb(memAfterOps.rss),
      peakRssMb: mb(maxRssKb * 1024),
      approxModelMb: mb(catalog.approxBytes),
    },
    wroteProjectsData: false,
  };

  // Release (isolation between in-process scenarios).
  catalog.placements.length = 0;
  return result;
}

/**
 * Validate one scenario result against the synthetic invariants.
 * @param {object} r
 */
function assertScenario(r, size) {
  assert(r.unique === size, "unique matches for " + size);
  assert(r.placements === size, "placements length for " + size);
  assert(Number.isFinite(r.approxBytes) && r.approxBytes > 0, "approxBytes finite for " + size);
  assert(r.timings.dedupeUnique === size, "dedupe unique for " + size);
  assert(Number.isFinite(r.timings.dedupeMs), "dedupeMs finite for " + size);
  assert(Number.isFinite(r.timings.shardEstimateMs), "shardEstimateMs finite for " + size);
  assert(Number.isFinite(r.timings.filterSimMs), "filterSimMs finite for " + size);
  assert(Number.isFinite(r.timings.shardCount) && r.timings.shardCount >= 1, "shardCount for " + size);
  assert(Number.isFinite(r.timings.filterKept), "filterKept finite for " + size);
  assert(Number.isFinite(r.synthesizeMs) && r.synthesizeMs >= 0, "synthesizeMs finite for " + size);
  assert(Number.isFinite(r.totalMs) && r.totalMs >= 0, "totalMs finite for " + size);
  assert(Number.isFinite(r.memory.heapUsedAfterOpsMb), "heap memory finite for " + size);
  assert(Number.isFinite(r.memory.rssAfterOpsMb) && r.memory.rssAfterOpsMb > 0, "rss finite for " + size);
  assert(r.wroteProjectsData === false, "wroteProjectsData false for " + size);
}

/**
 * Summarize scenario runs (timing + memory) for a compact table.
 * @param {object[]} runs
 */
export function summarizeLoadRuns(runs) {
  return {
    scenarios: runs.length,
    sizes: runs.map((r) => r.uniqueProducts),
    totalMsSum: runs.reduce((a, r) => a + r.totalMs, 0),
    maxTotalMs: runs.reduce((a, r) => Math.max(a, r.totalMs), 0),
    maxHeapDeltaMb: runs.reduce((a, r) => Math.max(a, r.memory.heapDeltaMb), 0),
    maxPeakRssMb: runs.reduce((a, r) => Math.max(a, r.memory.peakRssMb), 0),
    table: runs.map((r) => ({
      size: r.uniqueProducts,
      synthesizeMs: Math.round(r.synthesizeMs * 100) / 100,
      dedupeMs: Math.round(r.timings.dedupeMs * 100) / 100,
      filterSimMs: Math.round(r.timings.filterSimMs * 100) / 100,
      totalMs: Math.round(r.totalMs * 100) / 100,
      heapDeltaMb: r.memory.heapDeltaMb,
      peakRssMb: r.memory.peakRssMb,
    })),
  };
}

/**
 * Run scale scenarios, each in its OWN child process (isolated heap + peakRSS).
 * Offline: child processes only run this same script with --scenario.
 * @param {number[]} sizes
 * @returns {object[]}
 */
export function runIsolatedScaleScenarios(sizes) {
  const self = fileURLToPath(import.meta.url);
  const runs = [];
  for (const size of sizes) {
    const proc = spawnSync(
      process.execPath,
      ["--expose-gc", self, "--scenario", String(size)],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (proc.status !== 0) {
      throw new Error(
        "catalog-load-harness: scenario " + size + " failed: " + (proc.stderr || proc.stdout || "").trim(),
      );
    }
    const run = JSON.parse(proc.stdout);
    assertScenario(run, size);
    runs.push(run);
  }
  return runs;
}

/**
 * Selftest: CI-safe default sizes 1k/5k (in-process, plus one isolated child
 * scenario proving the process-isolation path). IU_CJ_LOAD_MAX extends tiers.
 * @param {{ max?: number|string, isolated?: boolean }} [opts]
 */
export function runCatalogLoadHarnessSelftest(opts = {}) {
  const maxRaw = opts.max != null ? opts.max : process.env.IU_CJ_LOAD_MAX;
  const sizes = resolveScaleSizes(maxRaw, LOAD_DEFAULT_SELFTEST_MAX);
  const runs = [];

  for (const size of sizes) {
    const run = runLoadScenario(size);
    assertScenario(run, size);
    runs.push(run);
  }

  // Scenarios must be independent: rerunning the smallest tier gives identical invariants.
  const again = runLoadScenario(sizes[0]);
  assertScenario(again, sizes[0]);
  assert(again.timings.filterKept === runs[0].timings.filterKept, "scenario isolation deterministic");

  let isolatedChild = null;
  if (opts.isolated !== false) {
    const [child] = runIsolatedScaleScenarios([sizes[0]]);
    assert(child.timings.dedupeUnique === sizes[0], "isolated child scenario result");
    isolatedChild = { uniqueProducts: child.uniqueProducts, peakRssMb: child.memory.peakRssMb };
  }

  return {
    schema: CATALOG_LOAD_HARNESS_SCHEMA + "-selftest",
    ok: true,
    wroteProjectsData: false,
    growthEmailDisarmed: true,
    maxRequested: maxRaw != null && String(maxRaw).trim() !== "" ? Number(maxRaw) : LOAD_DEFAULT_SELFTEST_MAX,
    sizes,
    runs,
    isolatedChild,
    summary: summarizeLoadRuns(runs),
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const argv = process.argv.slice(2);
  const scenarioIdx = argv.indexOf("--scenario");
  if (scenarioIdx !== -1) {
    // Child mode: raw JSON of exactly one scenario.
    const run = runLoadScenario(argv[scenarioIdx + 1]);
    console.log(JSON.stringify(run));
  } else if (argv.includes("--scale")) {
    const sizes = resolveScaleSizes(process.env.IU_CJ_LOAD_MAX, LOAD_DEFAULT_SCALE_MAX);
    const runs = runIsolatedScaleScenarios(sizes);
    console.log(
      JSON.stringify(
        {
          IU_CJ_CATALOG_LOAD_SCALE: "PASS",
          schema: CATALOG_LOAD_HARNESS_SCHEMA + "-scale",
          wroteProjectsData: false,
          growthEmailDisarmed: true,
          isolatedProcesses: true,
          sizes,
          summary: summarizeLoadRuns(runs),
          runs,
        },
        null,
        2,
      ),
    );
  } else {
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
}
