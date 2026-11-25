#!/usr/bin/env node
/**
 * V51.8 — sync phase timing profiler (pure, no IO).
 *
 * accumulatePhaseTiming(map, phase, ms) — add duration into a phase bucket.
 * summarizeSyncProfile(map) — totalMs, phases sorted desc by ms, hotspot (longest).
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-sync-phase-profiler-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SYNC_PHASE_PROFILER_SCHEMA =
  "iu-cj-affiliate-phase3z-sync-phase-profiler-v51-8";

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function phaseKey(phase) {
  const s = String(phase ?? "").trim();
  return s || "unknown";
}

/**
 * Mutates (or creates) map[phase] by adding ms. Returns the map.
 * @param {Record<string, number>|null|undefined} map
 * @param {string} phase
 * @param {number} ms
 */
export function accumulatePhaseTiming(map, phase, ms) {
  const out = map && typeof map === "object" && !Array.isArray(map) ? map : {};
  const key = phaseKey(phase);
  const add = num(ms);
  out[key] = num(out[key]) + add;
  return out;
}

/**
 * @param {Record<string, number>|null|undefined} map
 * @returns {{ totalMs: number, phases: Array<{ phase: string, ms: number }>, hotspot: { phase: string, ms: number } | null }}
 */
export function summarizeSyncProfile(map) {
  const src = map && typeof map === "object" && !Array.isArray(map) ? map : {};
  const phases = Object.keys(src)
    .map((phase) => ({ phase, ms: num(src[phase]) }))
    .sort((a, b) => b.ms - a.ms || a.phase.localeCompare(b.phase));

  let totalMs = 0;
  for (const row of phases) totalMs += row.ms;

  const hotspot = phases.length > 0 ? { phase: phases[0].phase, ms: phases[0].ms } : null;

  return {
    schema: SYNC_PHASE_PROFILER_SCHEMA,
    totalMs,
    phases,
    hotspot,
  };
}

/** Fake-phase selftest: hotspot is the longest accumulated phase. */
export function runSyncPhaseProfilerSelftest() {
  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: cond === true, detail: detail ?? null });
  }

  const map = {};
  accumulatePhaseTiming(map, "fetch", 120);
  accumulatePhaseTiming(map, "normalize", 40);
  accumulatePhaseTiming(map, "fetch", 80); // fetch total 200
  accumulatePhaseTiming(map, "publish_validate", 55);
  accumulatePhaseTiming(map, "normalize", 10); // normalize total 50

  check("map_fetch_200", map.fetch === 200, map.fetch);
  check("map_normalize_50", map.normalize === 50, map.normalize);
  check("map_publish_55", map.publish_validate === 55, map.publish_validate);

  const summary = summarizeSyncProfile(map);
  check("totalMs_305", summary.totalMs === 305, summary.totalMs);
  check("phases_sorted_len_3", summary.phases.length === 3, summary.phases.length);
  check(
    "phases_sorted_desc",
    summary.phases[0].phase === "fetch" &&
      summary.phases[1].phase === "publish_validate" &&
      summary.phases[2].phase === "normalize",
    summary.phases,
  );
  check("hotspot_phase_fetch", summary.hotspot?.phase === "fetch", summary.hotspot);
  check("hotspot_ms_200", summary.hotspot?.ms === 200, summary.hotspot);

  // Longest wins even when accumulated across multiple calls
  const map2 = accumulatePhaseTiming({}, "short", 10);
  accumulatePhaseTiming(map2, "long", 1);
  accumulatePhaseTiming(map2, "long", 99);
  const s2 = summarizeSyncProfile(map2);
  check("hotspot_longest_phase", s2.hotspot?.phase === "long" && s2.hotspot?.ms === 100, s2.hotspot);

  const empty = summarizeSyncProfile({});
  check("empty_total_0", empty.totalMs === 0, empty.totalMs);
  check("empty_hotspot_null", empty.hotspot === null, empty.hotspot);

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: SYNC_PHASE_PROFILER_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    sample: {
      totalMs: summary.totalMs,
      hotspot: summary.hotspot,
      phases: summary.phases,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runSyncPhaseProfilerSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_SYNC_PHASE_PROFILER_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
