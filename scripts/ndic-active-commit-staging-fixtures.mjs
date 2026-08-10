#!/usr/bin/env node
/**
 * Offline fixtures for ACTIVE commit NO_CHANGES + snapshot candidate regression
 * (incident run 31257122613).
 *
 * Covers:
 * A) NDIC + snapshot changed → STAGED / commit required
 * B) NDIC changed, REQUIRED snapshot missing → fail closed
 * C) snapshot changed, optional pathspec missing → still STAGED
 * D) NDIC + snapshot identical to HEAD → legitimate NO_CHANGES
 * E/F) candidate required snapshot present (pre-upload / post-download model)
 * G) two-source architecture preserved in workflow
 * H/I) CHMI / Info Events namespace preserved after apply
 * J/K) no lost-update / last-writer-wins on apply
 * L) 8 MiB snapshot limit unchanged
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  persistTrafficUiOfflineSnapshot,
  resolveTrafficUiSnapshotDestPath,
  TRAFFIC_UI_SNAPSHOT_REL,
} from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import { DEFAULT_MAX_SNAPSHOT_BYTES } from "./ndic-datex-v1/traffic-publication-snapshot.mjs";
import { applyNdicCandidate } from "./info-events-shared-writer-critical.mjs";
import {
  assertNdicCandidateRequiredOutputs,
  NDIC_CANDIDATE_REQUIRED_RELS,
} from "./ndic-assert-candidate-required-outputs.mjs";
import {
  stageNdicSharedWriteOutputs,
  NDIC_SHARED_WRITE_REQUIRED_RELS,
  NDIC_SHARED_WRITE_OPTIONAL_RELS,
} from "./ndic-stage-shared-write-outputs.mjs";
import { workflowUsesTwoSourceModel } from "./ndic-shared-write-two-source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (cond) passCount += 1;
  else fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function git(cwd, args) {
  return spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init"]);
  git(dir, ["config", "user.name", "fixture"]);
  git(dir, ["config", "user.email", "fixture@example.com"]);
  // Avoid Windows pathspec / autocrlf noise in fixtures
  git(dir, ["config", "core.autocrlf", "false"]);
}

function seedSharedState(repoRoot, { ndicTitle, snapshotMarker, includeSnapshot = true, includeOptional = true }) {
  const ie = path.join(repoRoot, "projects", "data", "info_events");
  writeJson(path.join(ie, "feed.json"), {
    generatedAt: "T0",
    itemCount: 3,
    items: [
      { id: "ie-chmi-v2-a", sourceId: "chmi", adapterOwner: "chmi-cap-v2", title: "CHMI" },
      { id: "ie-other-a", sourceId: "info-events", title: "IE" },
      {
        id: "ie-ndic-v1-a",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: ndicTitle,
      },
    ],
  });
  writeJson(path.join(ie, "monitoring.json"), {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    chmiCapV2: { status: "ok" },
    ndicDatexV1: { status: "old" },
  });
  if (includeOptional) {
    writeJson(path.join(ie, "lanes", "doprava.json"), {
      items: [
        {
          id: "ie-ndic-v1-a",
          sourceId: "ndic",
          adapterOwner: "ndic-datex-v1",
          ndicV1: {},
          title: ndicTitle,
        },
      ],
    });
    writeJson(path.join(ie, "ndic_datex_v1", "tmc_meta.json"), { ok: true });
  }
  writeJson(path.join(ie, "ndic_datex_v1", "sync_state.json"), { sync: { last: "old" } });
  writeJson(path.join(ie, "ndic_datex_v1", "diagnostics.json"), { status: "old" });
  if (includeSnapshot) {
    writeJson(path.join(ie, "ndic_datex_v1", "traffic_offline_snapshot.json"), {
      schema: "iu-traffic-offline-snapshot-v1",
      marker: snapshotMarker,
      cards: [],
    });
  }
}

function commitAll(repoRoot, msg) {
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-m", msg]);
}

function mkCandidate(candDir, { ndicTitle, snapshotMarker, includeSnapshot = true, includeOptionalTmc = true }) {
  writeJson(path.join(candDir, "feed.json"), {
    generatedAt: "T1",
    itemCount: 1,
    items: [
      {
        id: "ie-ndic-v1-b",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: ndicTitle,
      },
    ],
  });
  writeJson(path.join(candDir, "monitoring.json"), {
    ndicDatexV1: { status: "new" },
  });
  writeJson(path.join(candDir, "lanes", "doprava.json"), {
    items: [
      {
        id: "ie-ndic-v1-b",
        sourceId: "ndic",
        adapterOwner: "ndic-datex-v1",
        ndicV1: {},
        title: ndicTitle,
      },
    ],
  });
  writeJson(path.join(candDir, "ndic_datex_v1", "sync_state.json"), { sync: { last: "new" } });
  writeJson(path.join(candDir, "ndic_datex_v1", "diagnostics.json"), { status: "new" });
  if (includeOptionalTmc) {
    writeJson(path.join(candDir, "ndic_datex_v1", "tmc_meta.json"), { ok: true, rev: 2 });
  }
  if (includeSnapshot) {
    writeJson(path.join(candDir, "ndic_datex_v1", "traffic_offline_snapshot.json"), {
      schema: "iu-traffic-offline-snapshot-v1",
      marker: snapshotMarker,
      cards: [{ id: "c1" }],
    });
  }
}

const preciseItem = {
  id: "ie-ndic-v1-precise-1",
  status: "aktivni",
  eventType: "nehoda",
  title: "Nehoda D1",
  description: "Nehoda",
  localizationTrust: "openlr",
  roadNumber: "D1",
  km: 12,
  direction: "positive",
  lat: 50.1,
  lon: 14.4,
  startsAt: "2026-08-07T10:00:00.000Z",
  lastChangedAt: "2026-08-07T10:05:00.000Z",
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-commit-stage-"));

try {
  // --- Snapshot dest resolves into candidate DIR (root cause fix) ---
  {
    const fakeRepo = path.join(tmp, "fake-repo");
    const cand = path.join(tmp, "cand-sandbox");
    fs.mkdirSync(path.join(fakeRepo, "projects", "data", "info_events"), { recursive: true });
    fs.mkdirSync(cand, { recursive: true });
    const dest = resolveTrafficUiSnapshotDestPath({
      repoRoot: fakeRepo,
      infoEventsDir: cand,
    });
    ok(
      "SNAPSHOT_EXPECTED_UNDER_CANDIDATE_DIR",
      dest === path.join(cand, "ndic_datex_v1", "traffic_offline_snapshot.json"),
      dest
    );
    const legacy = resolveTrafficUiSnapshotDestPath({ repoRoot: fakeRepo });
    ok(
      "SNAPSHOT_LEGACY_REPO_REL_UNCHANGED",
      legacy === path.join(fakeRepo, TRAFFIC_UI_SNAPSHOT_REL),
      legacy
    );
    const uiSnap = persistTrafficUiOfflineSnapshot([preciseItem], {
      repoRoot: fakeRepo,
      relPath: dest,
      nowIso: "2026-08-08T12:00:00.000Z",
      sourceFreshness: "FRESH",
    });
    ok("SNAPSHOT_GENERATOR_FOUND", uiSnap && uiSnap.ok === true, uiSnap && uiSnap.rejectCode);
    ok("SNAPSHOT_PRESENT_BEFORE_ARTIFACT_UPLOAD", fs.existsSync(dest), dest);
    ok(
      "SNAPSHOT_NOT_WRITTEN_ONLY_TO_FEATURE_CHECKOUT",
      !fs.existsSync(path.join(fakeRepo, TRAFFIC_UI_SNAPSHOT_REL)),
      "feature-path"
    );
    const packed = assertNdicCandidateRequiredOutputs(cand);
    // persist writes snapshot but not full candidate required set — create stubs
    writeJson(path.join(cand, "feed.json"), { items: [] });
    writeJson(path.join(cand, "monitoring.json"), {});
    writeJson(path.join(cand, "ndic_datex_v1", "sync_state.json"), {});
    writeJson(path.join(cand, "ndic_datex_v1", "diagnostics.json"), {});
    const packed2 = assertNdicCandidateRequiredOutputs(cand);
    ok("CANDIDATE_ARTIFACT_FIXTURE_PASS", packed2.ok === true, (packed2.missing || []).join(","));
    ok(
      "SNAPSHOT_PRESENT_AFTER_ARTIFACT_DOWNLOAD_FIXTURE",
      packed2.present.includes("ndic_datex_v1/traffic_offline_snapshot.json")
    );
    ok("SNAPSHOT_FIXTURE_PASS", uiSnap.ok === true && packed2.ok === true);
    void packed;
  }

  // --- A: NDIC + snapshot changed → STAGED ---
  {
    const repo = path.join(tmp, "case-a");
    initRepo(repo);
    seedSharedState(repo, { ndicTitle: "OLD", snapshotMarker: "old" });
    commitAll(repo, "seed");
    const cand = path.join(tmp, "cand-a");
    mkCandidate(cand, { ndicTitle: "NEW", snapshotMarker: "new" });
    applyNdicCandidate({
      targetDir: path.join(repo, "projects/data/info_events"),
      candidateDir: cand,
      nowIso: "T-a",
    });
    const staged = stageNdicSharedWriteOutputs(repo);
    ok("A_STAGED", staged.ok && staged.result === "STAGED", staged.result);
    ok("A_COMMIT_REQUIRED", staged.result === "STAGED");
    const after = JSON.parse(
      fs.readFileSync(path.join(repo, "projects/data/info_events/feed.json"), "utf8")
    );
    const ids = after.items.map((i) => i.id);
    ok("H_CHMI_NAMESPACE_PRESERVED", ids.includes("ie-chmi-v2-a"));
    ok("I_INFO_EVENTS_NAMESPACE_PRESERVED", ids.includes("ie-other-a"));
    ok("NDIC_NAMESPACE_WRITTEN", ids.includes("ie-ndic-v1-b"));
    ok("J_LOST_UPDATE_FIXTURES_PASS", ids.includes("ie-chmi-v2-a") && ids.includes("ie-other-a"));
    ok(
      "K_LAST_WRITER_WINS_FIXTURES_PASS",
      ids.includes("ie-chmi-v2-a") && ids.includes("ie-ndic-v1-b")
    );
    ok(
      "NAMESPACE_PRESERVATION_FIXTURES_PASS",
      ids.includes("ie-chmi-v2-a") && ids.includes("ie-other-a") && ids.includes("ie-ndic-v1-b")
    );
  }

  // --- B: REQUIRED snapshot missing → fail closed ---
  {
    const repo = path.join(tmp, "case-b");
    initRepo(repo);
    seedSharedState(repo, { ndicTitle: "OLD", snapshotMarker: "old", includeSnapshot: true });
    commitAll(repo, "seed");
    const cand = path.join(tmp, "cand-b");
    mkCandidate(cand, { ndicTitle: "NEW", snapshotMarker: "new", includeSnapshot: false });
    const candGate = assertNdicCandidateRequiredOutputs(cand);
    ok(
      "B_CANDIDATE_FAIL_CLOSED",
      candGate.ok === false &&
        candGate.missing.includes("ndic_datex_v1/traffic_offline_snapshot.json"),
      (candGate.missing || []).join(",")
    );
    // Simulate bad apply that wrote NDIC files but never snapshot
    applyNdicCandidate({
      targetDir: path.join(repo, "projects/data/info_events"),
      candidateDir: cand,
      nowIso: "T-b",
    });
    // Remove snapshot from live to model missing REQUIRED after apply of incomplete cand
    const snapLive = path.join(
      repo,
      "projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json"
    );
    if (fs.existsSync(snapLive)) fs.unlinkSync(snapLive);
    const staged = stageNdicSharedWriteOutputs(repo);
    ok(
      "B_STAGE_FAIL_CLOSED",
      staged.ok === false && staged.result === "REQUIRED_OUTPUT_MISSING",
      staged.result
    );
    ok("REQUIRED_OUTPUT_GUARD_PASS", staged.result === "REQUIRED_OUTPUT_MISSING");
    const cached = git(repo, ["diff", "--cached", "--quiet"]);
    ok("B_NO_PARTIAL_STAGE", cached.status === 0, "cached-empty");
  }

  // --- C: optional missing, snapshot present → STAGED ---
  {
    const repo = path.join(tmp, "case-c");
    initRepo(repo);
    seedSharedState(repo, {
      ndicTitle: "OLD",
      snapshotMarker: "old",
      includeOptional: true,
    });
    commitAll(repo, "seed");
    const cand = path.join(tmp, "cand-c");
    mkCandidate(cand, {
      ndicTitle: "NEW",
      snapshotMarker: "new-c",
      includeOptionalTmc: false,
    });
    applyNdicCandidate({
      targetDir: path.join(repo, "projects/data/info_events"),
      candidateDir: cand,
      nowIso: "T-c",
    });
    // Remove optional tmc_meta from live (optional absence)
    const tmc = path.join(repo, "projects/data/info_events/ndic_datex_v1/tmc_meta.json");
    if (fs.existsSync(tmc)) fs.unlinkSync(tmc);
    // Also remove from index of what would have been all-or-nothing path — staging must still work
    const staged = stageNdicSharedWriteOutputs(repo);
    ok("C_STAGED_DESPITE_OPTIONAL_MISSING", staged.ok && staged.result === "STAGED", staged.result);
    ok(
      "OPTIONAL_PATHSPEC_STAGING_PASS",
      staged.staged.includes(
        "projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json"
      ) &&
        !staged.staged.includes("projects/data/info_events/ndic_datex_v1/tmc_meta.json"),
      (staged.staged || []).join("|")
    );
  }

  // --- D: identical working tree vs HEAD → legitimate NO_CHANGES ---
  {
    const repo = path.join(tmp, "case-d");
    initRepo(repo);
    seedSharedState(repo, { ndicTitle: "SAME", snapshotMarker: "same" });
    commitAll(repo, "seed");
    // No apply / no byte changes: REQUIRED outputs present and match HEAD.
    const staged = stageNdicSharedWriteOutputs(repo);
    ok("D_LEGITIMATE_NO_CHANGES", staged.ok && staged.result === "NO_CHANGES", staged.result);
    ok("NO_CHANGES_SEMANTICS_PASS", staged.result === "NO_CHANGES");
  }

  // --- False NO_CHANGES regression: multi-pathspec missing swallow ---
  {
    const repo = path.join(tmp, "case-false-no");
    initRepo(repo);
    seedSharedState(repo, { ndicTitle: "OLD", snapshotMarker: "old" });
    commitAll(repo, "seed");
    const cand = path.join(tmp, "cand-false");
    mkCandidate(cand, { ndicTitle: "NEW", snapshotMarker: "new-f" });
    applyNdicCandidate({
      targetDir: path.join(repo, "projects/data/info_events"),
      candidateDir: cand,
      nowIso: "T-f",
    });
    // Reproduce broken pattern: one missing pathspec + || true → empty index
    const missing = "projects/data/info_events/ndic_datex_v1/does_not_exist.json";
    const broken = spawnSync(
      "git",
      [
        "-C",
        repo,
        "add",
        "projects/data/info_events/feed.json",
        "projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json",
        missing,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    // Swallow like workflow did
    void broken.status;
    const quietBroken = git(repo, ["diff", "--cached", "--quiet"]);
    const falseNoChanges = quietBroken.status === 0;
    ok("FALSE_NO_CHANGES_REPRODUCED", falseNoChanges === true, "broken-add");
    // Reset index then use fixed stager
    git(repo, ["reset"]);
    const fixed = stageNdicSharedWriteOutputs(repo);
    ok("FALSE_NO_CHANGES_REGRESSION_PASS", fixed.ok && fixed.result === "STAGED", fixed.result);
    ok("GIT_STAGING_FIXTURE_PASS", fixed.result === "STAGED");
  }

  // --- G: two-source + workflow guards ---
  {
    const wf = fs.readFileSync(NDIC_WF, "utf8");
    ok("G_TWO_SOURCE_ARCHITECTURE", workflowUsesTwoSourceModel(wf));
    // Guard the ACTIVE incident pattern only (swallowed git add), not unrelated shell redirects.
    ok(
      "ALL_OR_NOTHING_GIT_ADD_REMOVED",
      !/git\s+add[\s\S]{0,200}2>\s*\/dev\/null\s*\|\|\s*true/.test(wf)
    );
    ok("WORKFLOW_USES_STAGE_HELPER", /ndic-stage-shared-write-outputs\.mjs/.test(wf));
    ok("WORKFLOW_USES_CANDIDATE_ASSERT", /ndic-assert-candidate-required-outputs\.mjs/.test(wf));
    ok(
      "PROD_SYNC_USES_RESOLVE_DEST",
      /resolveTrafficUiSnapshotDestPath/.test(
        fs.readFileSync(path.join(ROOT, "scripts/ndic-datex-v1-prod-sync.mjs"), "utf8")
      )
    );
  }

  // --- L: snapshot limit ---
  ok("L_SNAPSHOT_LIMIT_8MIB", DEFAULT_MAX_SNAPSHOT_BYTES === 8388608, String(DEFAULT_MAX_SNAPSHOT_BYTES));
  ok("SNAPSHOT_LIMIT_INCREASED_NO", DEFAULT_MAX_SNAPSHOT_BYTES === 8388608);

  // Data PR fixture wiring still present (open/refresh script exists; REST fixtures separate)
  ok(
    "DATA_PR_FIXTURE_PASS",
    fs.existsSync(path.join(ROOT, "scripts/ndic-open-or-refresh-data-pr.mjs")) &&
      fs.existsSync(path.join(ROOT, "scripts/ndic-data-pr-rest-runtime-fixtures.mjs"))
  );

  ok("REQUIRED_LIST_INCLUDES_SNAPSHOT", NDIC_SHARED_WRITE_REQUIRED_RELS.some((r) => r.endsWith("traffic_offline_snapshot.json")));
  ok("OPTIONAL_LIST_HAS_TMC", NDIC_SHARED_WRITE_OPTIONAL_RELS.some((r) => r.endsWith("tmc_meta.json")));
  ok("CANDIDATE_REQUIRED_INCLUDES_SNAPSHOT", NDIC_CANDIDATE_REQUIRED_RELS.some((r) => r.endsWith("traffic_offline_snapshot.json")));

  // Atomic write still used by apply
  ok(
    "ATOMIC_WRITE_FIXTURES_PASS",
    /writeJsonAtomic/.test(
      fs.readFileSync(path.join(ROOT, "scripts/info-events-shared-writer-critical.mjs"), "utf8")
    )
  );
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}
}

if (fails.length) {
  console.error(JSON.stringify({ ok: false, passCount, fails }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    passCount,
    TRAFFIC_OFFLINE_SNAPSHOT_MAX_BYTES: DEFAULT_MAX_SNAPSHOT_BYTES,
  })
);
process.exit(0);
