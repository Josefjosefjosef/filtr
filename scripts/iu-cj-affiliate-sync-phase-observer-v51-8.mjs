#!/usr/bin/env node
/**
 * V51.8 — optional, read-only sync phase observer (thin wrapper over sync-phase-profiler).
 *
 * Default OFF. Enable with IU_CJ_SYNC_PHASE_PROFILE=1.
 * When OFF: timePhase(name, fn) just returns fn() — no clock reads, no IO, no state.
 * When ON : measures wall-clock per phase and prints JSON lines to STDERR only
 *           (never stdout, never audit/doc/public/D1/R2/email). Optional file sink via
 *           IU_CJ_SYNC_PHASE_PROFILE_OUT=<path> (append JSON line at process exit).
 *
 * The observer never alters the wrapped function's result or error.
 *
 * Integration points in offers-live-sync-v1.mjs (runOffersLiveSync):
 *   - product_discovery : sampleProductsForManagedPartners (phase2 product API discovery)
 *   - published_refresh : refreshPublishedProductsFromCj
 *   - miss_reverify     : reverifyMissProductsFromCj
 *
 * CLI selftest: node scripts/iu-cj-affiliate-sync-phase-observer-v51-8.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accumulatePhaseTiming,
  summarizeSyncProfile,
} from "./iu-cj-affiliate-phase3z-sync-phase-profiler-v51-8.mjs";

export const SYNC_PHASE_OBSERVER_SCHEMA = "iu-cj-affiliate-sync-phase-observer-v51-8";

export function isSyncPhaseProfileEnabled(env = process.env) {
  return String(env?.IU_CJ_SYNC_PHASE_PROFILE ?? "").trim() === "1";
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * @param {Record<string,string|undefined>} [env]
 * @param {{ stderr?: (line: string) => void, clock?: () => number, fileWriter?: (p: string, line: string) => void, registerExit?: boolean }} [io]
 */
export function createSyncPhaseObserver(env = process.env, io = {}) {
  const enabled = isSyncPhaseProfileEnabled(env);
  if (!enabled) {
    return {
      enabled: false,
      timePhase: (_phase, fn) => fn(),
      summary: () => null,
      flush: () => null,
    };
  }
  const clock = io.clock || nowMs;
  const stderr = io.stderr || ((line) => process.stderr.write(line + "\n"));
  const outPath = String(env.IU_CJ_SYNC_PHASE_PROFILE_OUT || "").trim();
  const fileWriter =
    io.fileWriter || ((p, line) => fs.appendFileSync(p, line + "\n", "utf8"));
  const map = {};
  let flushed = false;

  function summary() {
    return summarizeSyncProfile(map);
  }

  function flush() {
    if (flushed) return null;
    flushed = true;
    const s = summary();
    if (s.phases.length === 0) return s;
    const line = JSON.stringify({ IU_CJ_SYNC_PHASE_PROFILE: "SUMMARY", observeOnly: true, ...s });
    try {
      stderr(line);
      if (outPath) fileWriter(outPath, line);
    } catch {
      /* observation must never affect the run */
    }
    return s;
  }

  async function timePhase(phase, fn) {
    const t0 = clock();
    try {
      return await fn();
    } finally {
      let ms = 0;
      try {
        ms = Math.max(0, clock() - t0);
        accumulatePhaseTiming(map, phase, ms);
        stderr(
          JSON.stringify({ IU_CJ_SYNC_PHASE_PROFILE: "PHASE", observeOnly: true, phase, ms }),
        );
      } catch {
        /* never throw from observation */
      }
    }
  }

  if (io.registerExit !== false) process.once("exit", flush);

  return { enabled: true, timePhase, summary, flush };
}

/** Selftest: OFF is a transparent no-op; ON measures, never alters results/errors. */
export async function runSyncPhaseObserverSelftest() {
  const checks = [];
  const check = (name, cond, detail) => checks.push({ name, ok: cond === true, detail: detail ?? null });

  check("default_off_empty_env", isSyncPhaseProfileEnabled({}) === false);
  check("off_when_0", isSyncPhaseProfileEnabled({ IU_CJ_SYNC_PHASE_PROFILE: "0" }) === false);
  check("on_when_1", isSyncPhaseProfileEnabled({ IU_CJ_SYNC_PHASE_PROFILE: "1" }) === true);

  // OFF: pass-through, sync value returned as-is (not wrapped in promise), no output.
  const offLines = [];
  const off = createSyncPhaseObserver({}, { stderr: (l) => offLines.push(l) });
  const sentinel = { a: 1 };
  check("off_disabled", off.enabled === false);
  check("off_passthrough_identity", off.timePhase("x", () => sentinel) === sentinel);
  check("off_no_output", offLines.length === 0 && off.flush() === null && off.summary() === null);

  // ON with fake clock.
  const lines = [];
  const files = [];
  let t = 0;
  const steps = [0, 100, 100, 130, 130, 140, 140, 150]; // phase deltas: 100, 30, 10, 10
  const clock = () => steps[t++ % steps.length];
  const on = createSyncPhaseObserver(
    { IU_CJ_SYNC_PHASE_PROFILE: "1", IU_CJ_SYNC_PHASE_PROFILE_OUT: "x.jsonl" },
    { stderr: (l) => lines.push(l), clock, fileWriter: (p, l) => files.push([p, l]), registerExit: false },
  );
  check("on_enabled", on.enabled === true);
  const r1 = await on.timePhase("product_discovery", async () => ({ products: [1, 2] }));
  check("on_result_unchanged", Array.isArray(r1.products) && r1.products.length === 2, r1);
  await on.timePhase("published_refresh", () => "sync-ok");
  await on.timePhase("product_discovery", () => 1);
  let thrown = null;
  try {
    await on.timePhase("miss_reverify", () => {
      throw new Error("boom");
    });
  } catch (e) {
    thrown = e;
  }
  check("on_error_propagates_unchanged", thrown && thrown.message === "boom", thrown && thrown.message);

  const s = on.flush();
  check("on_phases_4_lines_plus_summary", lines.length === 5, lines.length);
  check("on_summary_hotspot_discovery", s.hotspot?.phase === "product_discovery" && s.hotspot?.ms === 110, s.hotspot);
  check("on_summary_total_150", s.totalMs === 150, s.totalMs);
  check("on_file_sink_once", files.length === 1 && files[0][0] === "x.jsonl", files.length);
  check("on_flush_idempotent", on.flush() === null && files.length === 1);
  check("on_lines_observe_only", lines.every((l) => JSON.parse(l).observeOnly === true));

  // Static guard: observer module has no side-channel touching product/growth/publish surfaces.
  const full = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const src = full.slice(0, full.indexOf("/** Selftest: OFF"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const forbidden = ["stdout", "projects/data", "d1", "r2", "uncapped", "smtp", "publish"];
  const hits = forbidden.filter((w) => new RegExp(w, "i").test(code.replace(/observeOnly|IU_CJ_SYNC_PHASE_PROFILE/g, "")));
  check("static_no_forbidden_surfaces", hits.length === 0, hits);

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: SYNC_PHASE_OBSERVER_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  return !!arg && path.resolve(arg) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const result = await runSyncPhaseObserverSelftest();
  console.log(
    JSON.stringify({ IU_CJ_SYNC_PHASE_OBSERVER_SELFTEST: result.ok ? "PASS" : "FAIL", ...result }, null, 2),
  );
  if (!result.ok) process.exit(1);
}
