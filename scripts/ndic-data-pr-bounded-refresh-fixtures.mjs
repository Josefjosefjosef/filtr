#!/usr/bin/env node
/**
 * Offline concurrency fixtures for shared feed.json NDIC×CHMI Data PR refresh.
 *
 * A) Base CHMI=A NDIC=OLD; NDIC prepares NEW; CHMI→B ⇒ result CHMI=B + NDIC=NEW
 * B) Two legitimate data-only main shifts ⇒ bounded refresh succeeds
 * C) More shifts than DATA_PR_REFRESH_MAX ⇒ fail-closed
 * D) Unsafe workflow/security drift ⇒ fail-closed (not treated as safe data-only)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyChmiCandidate,
  isNdicItem,
  isChmiItem,
} from "./info-events-shared-writer-critical.mjs";
import {
  DATA_PR_REFRESH_MAX,
  DATA_PR_REFRESH_FLAGS,
  classifyDataPrDrift,
  assertNamespaceMergeResult,
  runBoundedDataPrRefresh,
  applyNdicCandidateOntoCurrentMain,
} from "./ndic-data-pr-bounded-refresh.mjs";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (cond) passCount += 1;
  else fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-bounded-refresh-" + label + "-"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function mkIeTree(root, feed, mon) {
  const dir = path.join(root, "projects", "data", "info_events");
  fs.mkdirSync(path.join(dir, "ndic_datex_v1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "lanes"), { recursive: true });
  writeJson(path.join(dir, "feed.json"), feed);
  writeJson(path.join(dir, "monitoring.json"), mon);
  writeJson(path.join(dir, "lanes", "doprava.json"), {
    items: (feed.items || []).filter((i) => isNdicItem(i) || String(i.sourceId) === "hzs"),
  });
  writeJson(path.join(dir, "ndic_datex_v1", "sync_state.json"), { ok: true });
  return dir;
}

function baseMon() {
  return {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    chmiCapV2: { status: "ok", rev: 1 },
    ndicDatexV1: { status: "ok", rev: 1 },
    feedItemCount: 3,
    laneCounts: { doprava: 1 },
  };
}

function feedBase() {
  return {
    generatedAt: "T0",
    itemCount: 3,
    items: [
      {
        id: "ie-chmi-v2-a",
        sourceId: "chmi",
        adapterOwner: "chmi-cap-v2",
        capV2: { v: 1 },
        title: "CHMI-A",
      },
      { id: "ie-other-a", sourceId: "info-events", title: "IE-OTHER" },
      {
        id: "ie-ndic-v1-old",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: { rev: "OLD" },
        title: "NDIC-OLD",
        trust: { score: 1, unverifiedLocation: 0 },
        timeline: { start: "T0" },
        mapSafety: { ok: true },
      },
    ],
  };
}

function mkNdicCandidate(dir, item) {
  fs.mkdirSync(path.join(dir, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ndic_datex_v1"), { recursive: true });
  writeJson(path.join(dir, "feed.json"), { generatedAt: "T-cand", items: [item] });
  writeJson(path.join(dir, "monitoring.json"), {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    ndicDatexV1: {
      status: "ok",
      rev: item.ndicV1 && item.ndicV1.rev ? item.ndicV1.rev : "NEW",
    },
  });
  writeJson(path.join(dir, "lanes", "doprava.json"), { items: [item] });
  writeJson(path.join(dir, "ndic_datex_v1", "sync_state.json"), { ok: true, mode: "active" });
  writeJson(path.join(dir, "ndic_datex_v1", "diagnostics.json"), { ok: true });
  writeJson(path.join(dir, "ndic_datex_v1", "traffic_offline_snapshot.json"), {
    itemCount: 1,
    items: [item],
  });
  return dir;
}

function mkChmiCandidate(dir, item) {
  fs.mkdirSync(path.join(dir, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "chmi_cap_v2"), { recursive: true });
  writeJson(path.join(dir, "feed.json"), { items: [item] });
  writeJson(path.join(dir, "monitoring.json"), {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    chmiCapV2: { status: "ok", rev: item.capV2 && item.capV2.v },
  });
  writeJson(path.join(dir, "lanes", "pocasi.json"), { items: [item] });
  return dir;
}

function ndicNewItem() {
  return {
    id: "ie-ndic-v1-new",
    sourceId: "ndic",
    adapterOwner: "ndic-datex-v1",
    ndicV1: { rev: "NEW" },
    title: "NDIC-NEW",
    trust: { score: 1, unverifiedLocation: 0 },
    timeline: { start: "T1" },
    mapSafety: { ok: true },
  };
}

ok("flags_bounded", DATA_PR_REFRESH_FLAGS.DATA_PR_REFRESH_BOUNDED === "YES");
ok("flags_max", Number(DATA_PR_REFRESH_FLAGS.DATA_PR_REFRESH_MAX) === DATA_PR_REFRESH_MAX);
ok("flags_unbounded_no", DATA_PR_REFRESH_FLAGS.UNBOUNDED_RETRY_POSSIBLE === "NO");
ok("flags_no_ours_theirs", DATA_PR_REFRESH_FLAGS.GIT_OURS_THEIRS_USED === "NO");

// ---------- A: concurrent CHMI during NDIC finalization ----------
{
  const root = tmpRoot("a");
  const ie = mkIeTree(root, feedBase(), baseMon());
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), ndicNewItem());

  // Concurrent CHMI advances main to B before NDIC final commit
  applyChmiCandidate({
    targetDir: ie,
    candidateDir: mkChmiCandidate(path.join(root, "chmi-b"), {
      id: "ie-chmi-v2-b",
      sourceId: "chmi",
      adapterOwner: "chmi-cap-v2",
      capV2: { v: 2 },
      title: "CHMI-B",
    }),
    nowIso: "T-B",
  });

  const applied = applyNdicCandidateOntoCurrentMain({
    targetDir: ie,
    ndicCandidateDir: cand,
    repoRoot: root,
    baseMainSha: "sha-main-B",
    writerRunId: "run-A",
  });
  ok("A_apply_ok", applied.ok === true);
  ok("A_chmi_preserved_flag", applied.CHMI_PRESERVED_FROM_CURRENT_MAIN === "YES");

  const ns = assertNamespaceMergeResult({
    targetDir: ie,
    expectChmiId: "ie-chmi-v2-b",
    expectNdicId: "ie-ndic-v1-new",
    expectOtherId: "ie-other-a",
    forbidChmiId: "ie-chmi-v2-a",
    forbidNdicId: "ie-ndic-v1-old",
  });
  ok("SHARED_FEED_CONCURRENT_CHMI_TEST_PASS", ns.ok === true, JSON.stringify(ns));
  ok("LATEST_CHMI_PRESERVED_TEST_PASS", ns.LATEST_CHMI_PRESERVED === "YES");
  ok("LATEST_NDIC_PRESERVED_TEST_PASS", ns.LATEST_NDIC_PRESERVED === "YES");
  ok("UNRELATED_NAMESPACE_PRESERVED_TEST_PASS", ns.UNRELATED_NAMESPACE_PRESERVED === "YES");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- B: two data-only shifts within budget ----------
{
  let mainShift = 0;
  const root = tmpRoot("b");
  const ie = mkIeTree(root, feedBase(), baseMon());
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), ndicNewItem());

  const result = await runBoundedDataPrRefresh({
    maxAttempts: DATA_PR_REFRESH_MAX,
    classifyDrift: () =>
      classifyDataPrDrift(["projects/data/info_events/feed.json"]),
    rereadAndApply: async ({ attempt }) => {
      mainShift += 1;
      applyChmiCandidate({
        targetDir: ie,
        candidateDir: mkChmiCandidate(path.join(root, "chmi-" + attempt), {
          id: "ie-chmi-v2-shift-" + attempt,
          sourceId: "chmi",
          adapterOwner: "chmi-cap-v2",
          capV2: { v: 10 + attempt },
          title: "CHMI-SHIFT-" + attempt,
        }),
        nowIso: "T-S" + attempt,
      });
      return applyNdicCandidateOntoCurrentMain({
        targetDir: ie,
        ndicCandidateDir: cand,
        repoRoot: root,
        baseMainSha: "sha-B-" + attempt,
        writerRunId: "run-B-" + attempt,
      });
    },
    // First attempt still "dirty" (second CHMI lands); second attempt clean.
    isMergeClean: ({ attempt }) => attempt >= 2,
  });

  ok("B_ok", result.ok === true && result.MERGE_CLEAN === "YES");
  ok("B_refresh_count", result.refreshCount === 2);
  ok("B_two_shifts", mainShift === 2);
  const ns = assertNamespaceMergeResult({
    targetDir: ie,
    expectChmiId: "ie-chmi-v2-shift-2",
    expectNdicId: "ie-ndic-v1-new",
    expectOtherId: "ie-other-a",
  });
  ok("BOUNDED_REFRESH_TEST_PASS", result.ok === true && ns.ok === true, JSON.stringify(result.reason));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- C: more shifts than limit → fail-closed ----------
{
  const root = tmpRoot("c");
  const ie = mkIeTree(root, feedBase(), baseMon());
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), ndicNewItem());
  let applies = 0;
  const result = await runBoundedDataPrRefresh({
    maxAttempts: DATA_PR_REFRESH_MAX,
    classifyDrift: () => classifyDataPrDrift(["projects/data/info_events/feed.json"]),
    rereadAndApply: async ({ attempt }) => {
      applies += 1;
      applyChmiCandidate({
        targetDir: ie,
        candidateDir: mkChmiCandidate(path.join(root, "chmi-c-" + attempt), {
          id: "ie-chmi-v2-c-" + attempt,
          sourceId: "chmi",
          adapterOwner: "chmi-cap-v2",
          capV2: { v: 20 + attempt },
          title: "CHMI-C-" + attempt,
        }),
        nowIso: "T-C" + attempt,
      });
      return applyNdicCandidateOntoCurrentMain({
        targetDir: ie,
        ndicCandidateDir: cand,
        repoRoot: root,
        baseMainSha: "sha-C-" + attempt,
        writerRunId: "run-C-" + attempt,
      });
    },
    isMergeClean: () => false,
  });
  ok("C_fail_closed", result.ok === false && result.reason === "DATA_PR_REFRESH_LIMIT_EXCEEDED");
  ok("C_max_attempts", applies === DATA_PR_REFRESH_MAX && result.refreshCount === DATA_PR_REFRESH_MAX);
  ok("C_unbounded_no", result.UNBOUNDED_RETRY_POSSIBLE === "NO");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- D: unsafe workflow/security drift fail-closed ----------
{
  const drift = classifyDataPrDrift([
    "projects/data/info_events/feed.json",
    ".github/workflows/update-ndic-datex-v1.yml",
  ]);
  ok("D_classify_unsafe", drift.UNSAFE_DRIFT === "YES" && drift.ok === false);

  const result = await runBoundedDataPrRefresh({
    maxAttempts: DATA_PR_REFRESH_MAX,
    classifyDrift: () =>
      classifyDataPrDrift([
        "projects/data/info_events/feed.json",
        ".github/workflows/update-ndic-datex-v1.yml",
      ]),
    rereadAndApply: async () => {
      throw new Error("MUST_NOT_APPLY_ON_UNSAFE_DRIFT");
    },
    isMergeClean: () => true,
  });
  ok("D_no_apply", result.ok === false && result.reason === "UNSAFE_DRIFT_FAIL_CLOSED");
  ok("UNSAFE_DRIFT_FAIL_CLOSED_TEST_PASS", result.UNSAFE_DRIFT_FAIL_CLOSED === "YES");

  const safeOnly = classifyDataPrDrift([
    "projects/data/info_events/feed.json",
    "projects/data/info_events/monitoring.json",
  ]);
  ok("D_safe_data_only", safeOnly.SAFE_DATA_ONLY_DRIFT === "YES" && safeOnly.ok === true);
}

if (fails.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        failCount: fails.length,
        passCount,
        fails,
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    passCount,
    SHARED_FEED_CONCURRENT_CHMI_TEST_PASS: "YES",
    LATEST_CHMI_PRESERVED_TEST_PASS: "YES",
    LATEST_NDIC_PRESERVED_TEST_PASS: "YES",
    UNRELATED_NAMESPACE_PRESERVED_TEST_PASS: "YES",
    BOUNDED_REFRESH_TEST_PASS: "YES",
    UNSAFE_DRIFT_FAIL_CLOSED_TEST_PASS: "YES",
    DATA_PR_REFRESH_BOUNDED: "YES",
    DATA_PR_REFRESH_MAX: DATA_PR_REFRESH_MAX,
    UNBOUNDED_RETRY_POSSIBLE: "NO",
    ...DATA_PR_REFRESH_FLAGS,
  })
);
process.exit(0);
