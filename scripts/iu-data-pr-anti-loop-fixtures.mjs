#!/usr/bin/env node
/**
 * Offline fixtures A–H for DATA_PR_FINALIZATION_PROTOCOL anti-loop protection.
 * No network, no VPS, no NDIC credentials, no ACTIVE sync.
 *
 * A) NDIC PR vs main A; CHMI → main B → STALE
 * B) Safe refresh: CHMI from B + original NDIC → mergeable
 * C) After refresh, another CHMI before finalization → stale again
 * D) During finalization critical section new CHMI cannot cause lost update
 * E) Unrelated source-code commit → not false stale if digests same
 * F) Refresh must not create duplicate Data PR
 * G) Safe refresh needs no NDIC credentials/network
 * H) Safe refresh must not change NDIC card count / trust / timeline / map safety
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyChmiCandidate,
  writeJsonAtomic,
  isNdicItem,
  isChmiItem,
} from "./info-events-shared-writer-critical.mjs";
import {
  computeSharedStateDigests,
  evaluateBaseFreshness,
  writeDataPrBinding,
  rebaseSharedNamespacesFromCurrentMain,
  runFinalizationCriticalSection,
  PROTOCOL_FLAGS,
} from "./iu-data-pr-finalization-protocol.mjs";
import { safeRefreshDataPr } from "./iu-data-pr-safe-shared-namespace-refresh.mjs";
import { runOpenOrRefreshDataPr } from "./ndic-open-or-refresh-data-pr.mjs";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (cond) passCount += 1;
  else fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iu-data-pr-anti-loop-" + label + "-"));
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

function feedMainA() {
  return {
    generatedAt: "T-A",
    itemCount: 3,
    items: [
      {
        id: "ie-chmi-v2-a",
        sourceId: "chmi",
        adapterOwner: "chmi-cap-v2",
        capV2: { v: 1 },
        title: "CHMI-A",
      },
      { id: "ie-other-a", sourceId: "info-events", title: "IE-A" },
      {
        id: "ie-ndic-v1-a",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: "NDIC-A",
        trust: { score: 1 },
        timeline: { start: "T0" },
        mapSafety: { ok: true },
      },
    ],
  };
}

function mkNdicCandidate(dir, item) {
  fs.mkdirSync(path.join(dir, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ndic_datex_v1"), { recursive: true });
  writeJson(path.join(dir, "feed.json"), {
    generatedAt: "T-cand",
    items: [item],
  });
  writeJson(path.join(dir, "monitoring.json"), {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    ndicDatexV1: { status: "ok", rev: 1 },
  });
  writeJson(path.join(dir, "lanes", "doprava.json"), { items: [item] });
  writeJson(path.join(dir, "ndic_datex_v1", "sync_state.json"), { ok: true });
  writeJson(path.join(dir, "ndic_datex_v1", "diagnostics.json"), { ok: true });
  writeJson(path.join(dir, "ndic_datex_v1", "traffic_offline_snapshot.json"), {
    itemCount: 1,
    items: [item],
  });
  return dir;
}

function mkChmiCandidate(dir, chmiItem) {
  fs.mkdirSync(path.join(dir, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "chmi_cap_v2"), { recursive: true });
  writeJson(path.join(dir, "feed.json"), { items: [chmiItem] });
  writeJson(path.join(dir, "monitoring.json"), {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    chmiCapV2: { status: "ok", rev: 2 },
  });
  writeJson(path.join(dir, "lanes", "pocasi.json"), { items: [chmiItem] });
  return dir;
}

// ---------- A: STALE when CHMI moves main ----------
{
  const root = tmpRoot("a");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const digA = computeSharedStateDigests(ie);
  const binding = writeDataPrBinding(root, {
    baseMainSha: "sha-main-A",
    digests: digA,
    generatedByWriter: "ndic",
    writerRunId: "run-A",
  });
  ok("A_binding_fields", Boolean(binding.baseMainSha && binding.chmiDigest && binding.ndicDigest));

  const chmiCand = mkChmiCandidate(path.join(root, "chmi-cand"), {
    id: "ie-chmi-v2-b",
    sourceId: "chmi",
    adapterOwner: "chmi-cap-v2",
    capV2: { v: 2 },
    title: "CHMI-B",
  });
  applyChmiCandidate({ targetDir: ie, candidateDir: chmiCand, nowIso: "T-B" });
  const digB = computeSharedStateDigests(ie);
  const fresh = evaluateBaseFreshness({
    recorded: binding,
    currentMainDigests: digB,
    currentMainSha: "sha-main-B",
  });
  ok("A_STALE", fresh.STALE === true && fresh.MERGE_READY === "NO", fresh.reason);
  ok("A_chmi_changed", fresh.changedNamespaces.includes("CHMI"));
  ok(
    "DATA_PR_BASE_FRESHNESS_FIXTURES_PASS",
    fresh.STALE === true && fresh.BASE_HEAD_SEMANTICALLY_COMPATIBLE === "NO"
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- B: Safe refresh → mergeable ----------
{
  const root = tmpRoot("b");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const digA = computeSharedStateDigests(ie);
  writeDataPrBinding(root, {
    baseMainSha: "sha-main-A",
    digests: digA,
    generatedByWriter: "ndic",
    writerRunId: "run-A",
  });

  const ndicItem = feedMainA().items.find(isNdicItem);
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), ndicItem);

  // CHMI advances main to B
  const chmiCand = mkChmiCandidate(path.join(root, "chmi-cand"), {
    id: "ie-chmi-v2-b",
    sourceId: "chmi",
    adapterOwner: "chmi-cap-v2",
    capV2: { v: 2 },
    title: "CHMI-B",
  });
  applyChmiCandidate({ targetDir: ie, candidateDir: chmiCand, nowIso: "T-B" });

  const rebase = rebaseSharedNamespacesFromCurrentMain({
    targetDir: ie,
    ndicCandidateDir: cand,
    repoRoot: root,
    baseMainSha: "sha-main-B",
    writerRunId: "safe-B",
    expectNdicCardCount: 1,
  });
  ok("B_rebase_ok", rebase.ok === true && rebase.REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN === "YES");
  ok("B_no_network", rebase.NETWORK_REQUIRED === "NO");

  const digAfter = computeSharedStateDigests(ie);
  const fresh = evaluateBaseFreshness({
    recorded: rebase.binding,
    currentMainDigests: digAfter,
    currentMainSha: "sha-main-B",
  });
  ok("B_mergeable", fresh.MERGE_READY === "YES" && fresh.STALE === false, fresh.reason);
  const feed = JSON.parse(fs.readFileSync(path.join(ie, "feed.json"), "utf8"));
  ok("B_keeps_chmi_b", feed.items.some((i) => i.id === "ie-chmi-v2-b"));
  ok("B_keeps_ndic", feed.items.some((i) => i.id === "ie-ndic-v1-a"));
  ok("SAFE_SHARED_NAMESPACE_REFRESH_FIXTURES_PASS", fresh.MERGE_READY === "YES");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- C: another CHMI after refresh → stale again ----------
{
  const root = tmpRoot("c");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const ndicItem = feedMainA().items.find(isNdicItem);
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), ndicItem);
  const rebase = rebaseSharedNamespacesFromCurrentMain({
    targetDir: ie,
    ndicCandidateDir: cand,
    repoRoot: root,
    baseMainSha: "sha-main-B",
    writerRunId: "safe-C1",
  });
  const chmiCand = mkChmiCandidate(path.join(root, "chmi-cand2"), {
    id: "ie-chmi-v2-c",
    sourceId: "chmi",
    adapterOwner: "chmi-cap-v2",
    capV2: { v: 3 },
    title: "CHMI-C",
  });
  applyChmiCandidate({ targetDir: ie, candidateDir: chmiCand, nowIso: "T-C" });
  const digC = computeSharedStateDigests(ie);
  const fresh = evaluateBaseFreshness({
    recorded: rebase.binding,
    currentMainDigests: digC,
    currentMainSha: "sha-main-C",
  });
  ok("C_stale_again", fresh.STALE === true && fresh.MERGE_READY === "NO");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- D: finalization lock prevents lost update ----------
{
  let mainMutatedDuringLock = false;
  let lockHeld = false;
  const root = tmpRoot("d");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const dig = computeSharedStateDigests(ie);
  const binding = writeDataPrBinding(root, {
    baseMainSha: "sha-main-D",
    digests: dig,
    generatedByWriter: "ndic",
    writerRunId: "run-D",
  });

  const result = runFinalizationCriticalSection({
    acquireLock: () => {
      lockHeld = true;
      return { ok: true };
    },
    releaseLock: () => {
      lockHeld = false;
    },
    reReadMain: () => ({
      sha: "sha-main-D",
      digests: dig,
      recorded: binding,
    }),
    recorded: binding,
    mergeFn: () => ({ merged: true }),
    concurrentWriterAttempt: ({ lockHeld: held }) => {
      if (held) {
        // CHMI writer blocked — cannot apply
        return { applied: false, blocked: true };
      }
      mainMutatedDuringLock = true;
      return { applied: true };
    },
  });
  ok("D_finalize_ok", result.ok === true && result.MERGE_READY === "YES");
  ok("D_no_lost_update", mainMutatedDuringLock === false);
  ok("D_short_lock", result.FINALIZATION_LONG_RUNNING_PHASE_INSIDE_LOCK === "NO");
  ok("D_no_whole_workflow_lock", result.WHOLE_WORKFLOW_SHARED_LOCK === "NO");
  ok(
    "DATA_PR_FINALIZATION_LOCK_FIXTURES_PASS",
    result.ok === true && result.DATA_PR_FINALIZATION_LOCK_IMPLEMENTED === "YES"
  );
  ok("LOST_UPDATE_FIXTURES_PASS", mainMutatedDuringLock === false && result.ok === true);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- E: unrelated commit → not false stale ----------
{
  const root = tmpRoot("e");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const digA = computeSharedStateDigests(ie);
  const binding = writeDataPrBinding(root, {
    baseMainSha: "sha-main-E0",
    digests: digA,
    generatedByWriter: "ndic",
    writerRunId: "run-E",
  });
  // Simulate unrelated main commit: only videos.json / source code — digests unchanged
  writeJson(path.join(root, "projects", "data", "videos.json"), { v: 2 });
  const digSame = computeSharedStateDigests(ie);
  const fresh = evaluateBaseFreshness({
    recorded: binding,
    currentMainDigests: digSame,
    currentMainSha: "sha-main-E1-unrelated",
  });
  ok("E_sha_changed", fresh.BASE_HEAD_STILL_CURRENT === "NO");
  ok("E_not_false_stale", fresh.STALE === false && fresh.BASE_HEAD_SEMANTICALLY_COMPATIBLE === "YES");
  ok("E_merge_ready", fresh.MERGE_READY === "YES");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- F: refresh must not create duplicate Data PR ----------
{
  let createCount = 0;
  const fetchImpl = async (url, init) => {
    const method = (init && init.method) || "GET";
    if (method === "GET" && String(url).includes("/pulls?")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify([
            { number: 9303, html_url: "https://example.test/pr/9303" },
          ]);
        },
      };
    }
    if (method === "POST") {
      createCount += 1;
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({ number: 9999, html_url: "https://example.test/pr/9999" });
        },
      };
    }
    return { ok: false, status: 500, async text() { return "{}"; } };
  };
  const r = await runOpenOrRefreshDataPr({
    env: {
      GH_TOKEN: "t",
      GITHUB_REPOSITORY: "Josefjosefjosef/filtr",
      AUTOMATION_BRANCH: "automation/update-ndic-datex-v1",
    },
    fetchImpl,
  });
  ok("F_reuses_existing", r.ok === true && r.action === "exists" && r.number === 9303);
  ok("F_no_create", createCount === 0 && r.createAttempted === false);
  ok("F_duplicate_impossible", r.DATA_PR_DUPLICATE_PR_POSSIBLE === "NO");
  ok("DUPLICATE_DATA_PR_FIXTURES_PASS", r.DATA_PR_DUPLICATE_PR_POSSIBLE === "NO" && createCount === 0);
}

// ---------- G: safe refresh needs no credentials/network ----------
{
  const root = tmpRoot("g");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const ndicItem = feedMainA().items.find(isNdicItem);
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), ndicItem);
  let threw = false;
  try {
    rebaseSharedNamespacesFromCurrentMain({
      targetDir: ie,
      ndicCandidateDir: cand,
      repoRoot: root,
      baseMainSha: "sha-g",
      ndicCredentials: { user: "x" },
    });
  } catch (e) {
    threw = /NETWORK|CREDENTIALS/i.test(String(e && e.message));
  }
  ok("G_rejects_credentials", threw === true);

  const safe = await safeRefreshDataPr({
    mainIeDir: ie,
    ndicCandidateDir: cand,
    repoRoot: root,
    baseMainSha: "sha-g",
    openOrRefresh: false,
  });
  ok("G_no_network_flag", safe.NETWORK_REQUIRED === "NO" && safe.NDIC_CREDENTIALS_REQUIRED === "NO");
  ok("G_no_vps", safe.VPS_REQUIRED === "NO" && safe.ACTIVE_SYNC_REQUIRED === "NO");
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- H: NDIC card count / trust / timeline / map safety ----------
{
  const root = tmpRoot("h");
  const ie = mkIeTree(root, feedMainA(), baseMon());
  const ndicItem = feedMainA().items.find(isNdicItem);
  const cand = mkNdicCandidate(path.join(root, "ndic-cand"), { ...ndicItem });

  // Advance CHMI on main, then rebase approved NDIC
  applyChmiCandidate({
    targetDir: ie,
    candidateDir: mkChmiCandidate(path.join(root, "chmi-cand"), {
      id: "ie-chmi-v2-h",
      sourceId: "chmi",
      adapterOwner: "chmi-cap-v2",
      capV2: { v: 9 },
      title: "CHMI-H",
    }),
    nowIso: "T-H",
  });

  const rebase = rebaseSharedNamespacesFromCurrentMain({
    targetDir: ie,
    ndicCandidateDir: cand,
    repoRoot: root,
    baseMainSha: "sha-h",
    expectNdicCardCount: 1,
  });
  const afterFeed = JSON.parse(fs.readFileSync(path.join(ie, "feed.json"), "utf8"));
  const ndicAfter = afterFeed.items.filter(isNdicItem);
  ok("H_card_count", ndicAfter.length === 1 && rebase.ndicCardCount === 1);
  ok("H_trust", JSON.stringify(ndicAfter[0].trust) === JSON.stringify(ndicItem.trust));
  ok("H_timeline", JSON.stringify(ndicAfter[0].timeline) === JSON.stringify(ndicItem.timeline));
  ok("H_map_safety", JSON.stringify(ndicAfter[0].mapSafety) === JSON.stringify(ndicItem.mapSafety));
  ok("NAMESPACE_PRESERVATION_FIXTURES_PASS", afterFeed.items.some(isChmiItem) && ndicAfter.length === 1);
  fs.rmSync(root, { recursive: true, force: true });
}

// Protocol flags
ok("WHOLE_WORKFLOW_SHARED_LOCK_NO", PROTOCOL_FLAGS.WHOLE_WORKFLOW_SHARED_LOCK === "NO");
ok("NETWORK_PREP_INSIDE_SHARED_LOCK_NO", PROTOCOL_FLAGS.NETWORK_PREP_INSIDE_SHARED_LOCK === "NO");
ok(
  "LONG_RUNNING_TESTS_INSIDE_SHARED_LOCK_NO",
  PROTOCOL_FLAGS.LONG_RUNNING_TESTS_INSIDE_SHARED_LOCK === "NO"
);

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
    DATA_PR_BASE_FRESHNESS_FIXTURES_PASS: "YES",
    SAFE_SHARED_NAMESPACE_REFRESH_FIXTURES_PASS: "YES",
    DATA_PR_FINALIZATION_LOCK_FIXTURES_PASS: "YES",
    LOST_UPDATE_FIXTURES_PASS: "YES",
    NAMESPACE_PRESERVATION_FIXTURES_PASS: "YES",
    DUPLICATE_DATA_PR_FIXTURES_PASS: "YES",
    DATA_PR_FINALIZATION_PROTOCOL_IMPLEMENTED: "YES",
    ...PROTOCOL_FLAGS,
  })
);
process.exit(0);
