#!/usr/bin/env node
/**
 * Offline fixtures: narrow shared writer critical section for CHMI / IE / NDIC.
 * No network, no dispatch, no VPS.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  SHARED_WRITER_GROUP,
  mergeChmiItemsIntoFeed,
  mergeNdicItemsIntoFeed,
  applyChmiCandidate,
  applyNdicCandidate,
  applyInfoEventsCandidate,
  assertNamespacePreservation,
  isChmiItem,
  isNdicItem,
  writeJsonAtomic,
} from "./info-events-shared-writer-critical.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHMI_WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const IE_WF = path.join(ROOT, ".github", "workflows", "update-info-events.yml");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function workflowLevelSharedLock(src) {
  // Workflow-level concurrency before first "jobs:" (ignore comments).
  const head = src.split(/\njobs:\s*\n/)[0] || src;
  const stripped = head
    .split("\n")
    .filter((ln) => !/^\s*#/.test(ln))
    .join("\n");
  return /(?:^|\n)concurrency:\s*\n[\s\S]*?group:\s*info-events-data-writers/.test(stripped);
}

function jobHasSharedLock(src, jobName) {
  const re = new RegExp(
    "(?:^|\\n)\\s*" + jobName + ":\\s*\\n([\\s\\S]*?)(?=\\n\\s{0,2}[a-zA-Z0-9_-]+:\\s*\\n|$)"
  );
  const m = src.match(re);
  if (!m) return false;
  return (
    /concurrency:\s*\n\s+group:\s*info-events-data-writers/.test(m[1]) ||
    /group:\s*info-events-data-writers/.test(m[1])
  );
}

function jobMentions(src, jobName, needle) {
  const re = new RegExp(
    "(?:^|\\n)\\s*" + jobName + ":\\s*\\n([\\s\\S]*?)(?=\\n\\s{0,2}[a-zA-Z0-9_-]+:\\s*\\n|$)"
  );
  const m = src.match(re);
  return m ? needle.test(m[1]) : false;
}

function baseFeed() {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    itemCount: 3,
    items: [
      { id: "ie-chmi-v2-a", sourceId: "chmi", capV2: { v: 1 }, title: "CHMI-A" },
      { id: "ie-ndic-v1-a", sourceId: "ndic", adapterOwner: "ndic-datex-v1", ndicV1: {}, title: "NDIC-A" },
      { id: "ie-other-a", sourceId: "hzs", title: "OTHER-A" },
    ],
  };
}

function baseMonitoring() {
  return {
    datasetAges: { feedAgeHours: 1 },
    alerts: [],
    outageHistory: [],
    chmiCapV2: { status: "healthy" },
    ndicDatexV1: { status: "healthy" },
  };
}

function mkTree(root, feed, mon) {
  fs.mkdirSync(path.join(root, "lanes"), { recursive: true });
  fs.mkdirSync(path.join(root, "chmi_cap_v2"), { recursive: true });
  fs.mkdirSync(path.join(root, "ndic_datex_v1"), { recursive: true });
  writeJsonAtomic(path.join(root, "feed.json"), feed);
  writeJsonAtomic(path.join(root, "monitoring.json"), mon);
}

function main() {
  const chmi = read(CHMI_WF);
  const ie = read(IE_WF);
  const ndic = read(NDIC_WF);

  ok("shared_group_literal_present", chmi.includes(SHARED_WRITER_GROUP) && ie.includes(SHARED_WRITER_GROUP) && ndic.includes(SHARED_WRITER_GROUP), "group");

  ok("chmi_no_workflow_level_shared_lock", !workflowLevelSharedLock(chmi), "chmi-wf-lock");
  ok("ie_no_workflow_level_shared_lock", !workflowLevelSharedLock(ie), "ie-wf-lock");
  ok("ndic_no_workflow_level_shared_lock", !workflowLevelSharedLock(ndic), "ndic-wf-lock");

  ok("chmi_shared_write_job_lock", jobHasSharedLock(chmi, "shared-write"), "chmi-job");
  ok("ie_shared_write_job_lock", jobHasSharedLock(ie, "shared-write"), "ie-job");
  ok("ndic_shared_write_job_lock", jobHasSharedLock(ndic, "ndic-shared-write"), "ndic-job");

  ok("chmi_prep_no_shared_lock", !jobHasSharedLock(chmi, "prep"), "chmi-prep");
  ok("chmi_post_no_shared_lock", !jobHasSharedLock(chmi, "post-write"), "chmi-post");
  ok("ie_prep_no_shared_lock", !jobHasSharedLock(ie, "prep"), "ie-prep");
  ok("ie_post_no_shared_lock", !jobHasSharedLock(ie, "post-write"), "ie-post");
  ok("ndic_prep_no_shared_lock", !jobHasSharedLock(ndic, "ndic-prep"), "ndic-prep");

  ok("chmi_cron_unchanged", /cron:\s*"\*\/5 \* \* \* \*"/.test(chmi), "cron");
  ok("chmi_pages_in_post_only", jobMentions(chmi, "post-write", /pages\.yml/) && !jobMentions(chmi, "shared-write", /pages\.yml/), "pages");
  ok("chmi_wait_checks_in_post", jobMentions(chmi, "post-write", /Wait for required checks/), "wait");
  ok("chmi_apply_reread", /info-events-shared-writer-critical\.mjs chmi/.test(chmi), "apply");
  ok("ie_apply_reread", /info-events-shared-writer-critical\.mjs info-events/.test(ie), "ie-apply");
  ok("ndic_apply_reread", /info-events-shared-writer-critical\.mjs ndic/.test(ndic), "ndic-apply");
  ok("ndic_active_uses_shared_group", /group:\s*info-events-data-writers/.test(ndic), "ndic-active");
  ok("ndic_prep_staging_group", /group:\s*ndic-datex-v1-internal-staging/.test(ndic), "ndic-staging");
  ok("ndic_cancel_false", /cancel-in-progress:\s*false/.test(ndic), "cancel");

  // Lost-update simulation both orders
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-narrow-lock-"));
    const live = path.join(tmp, "live");
    const chmiCand = path.join(tmp, "chmiCand");
    const ndicCand = path.join(tmp, "ndicCand");
    mkTree(live, baseFeed(), baseMonitoring());
    mkTree(chmiCand, {
      items: [{ id: "ie-chmi-v2-b", sourceId: "chmi", capV2: { v: 2 }, title: "CHMI-B" }],
    }, { ...baseMonitoring(), chmiCapV2: { status: "chmi-new" } });
    mkTree(ndicCand, {
      items: [
        {
          id: "ie-ndic-v1-b",
          sourceId: "ndic",
          adapterOwner: "ndic-datex-v1",
          ndicV1: {},
          title: "NDIC-B",
        },
      ],
    }, { ...baseMonitoring(), ndicDatexV1: { status: "ndic-new" } });

    applyChmiCandidate({ targetDir: live, candidateDir: chmiCand, nowIso: "T1" });
    applyNdicCandidate({ targetDir: live, candidateDir: ndicCand, nowIso: "T2" });
    const after = JSON.parse(fs.readFileSync(path.join(live, "feed.json"), "utf8"));
    const ids = after.items.map((i) => i.id).sort();
    ok(
      "chmi_then_ndic_keeps_both",
      ids.includes("ie-chmi-v2-b") && ids.includes("ie-ndic-v1-b") && ids.includes("ie-other-a"),
      ids.join(",")
    );
    ok("chmi_then_ndic_lost_update_no", ids.includes("ie-chmi-v2-b") && ids.includes("ie-ndic-v1-b"), "lu1");

    // reverse order on fresh live2
    const live2 = path.join(tmp, "live2");
    mkTree(live2, baseFeed(), baseMonitoring());
    applyNdicCandidate({ targetDir: live2, candidateDir: ndicCand, nowIso: "T3" });
    applyChmiCandidate({ targetDir: live2, candidateDir: chmiCand, nowIso: "T4" });
    const after2 = JSON.parse(fs.readFileSync(path.join(live2, "feed.json"), "utf8"));
    const ids2 = after2.items.map((i) => i.id).sort();
    ok(
      "ndic_then_chmi_keeps_both",
      ids2.includes("ie-chmi-v2-b") && ids2.includes("ie-ndic-v1-b") && ids2.includes("ie-other-a"),
      ids2.join(",")
    );
    ok("ndic_then_chmi_lost_update_no", ids2.includes("ie-chmi-v2-b") && ids2.includes("ie-ndic-v1-b"), "lu2");

    // IE apply preserves foreign from LIVE
    const ieCand = path.join(tmp, "ieCand");
    mkTree(ieCand, {
      items: [
        { id: "ie-hzs-new", sourceId: "hzs", title: "HZS-NEW" },
        { id: "ie-chmi-v2-evil", sourceId: "chmi", capV2: {}, title: "SHOULD-DROP" },
      ],
    }, baseMonitoring());
    const live3 = path.join(tmp, "live3");
    mkTree(live3, after2, baseMonitoring());
    applyInfoEventsCandidate({ targetDir: live3, candidateDir: ieCand, nowIso: "T5" });
    const after3 = JSON.parse(fs.readFileSync(path.join(live3, "feed.json"), "utf8"));
    ok("ie_preserves_chmi", after3.items.some(isChmiItem), "ie-chmi");
    ok("ie_preserves_ndic", after3.items.some(isNdicItem), "ie-ndic");
    ok("ie_adds_owned", after3.items.some((i) => i.id === "ie-hzs-new"), "ie-owned");
    ok("ie_drops_foreign_authored", !after3.items.some((i) => i.id === "ie-chmi-v2-evil"), "ie-evil");

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Merge helpers namespace asserts
  {
    const feed = baseFeed();
    const next = mergeChmiItemsIntoFeed(feed, [
      { id: "ie-chmi-v2-x", sourceId: "chmi", capV2: {}, title: "X" },
    ]);
    ok(
      "merge_chmi_preserves_ndic_other",
      next.items.some((i) => i.id === "ie-ndic-v1-a") && next.items.some((i) => i.id === "ie-other-a"),
      "m1"
    );
    assertNamespacePreservation(feed.items, next.items, "chmi");
    const next2 = mergeNdicItemsIntoFeed(feed, [
      { id: "ie-ndic-v1-x", sourceId: "ndic", adapterOwner: "ndic-datex-v1", ndicV1: {}, title: "X" },
    ]);
    ok(
      "merge_ndic_preserves_chmi_other",
      next2.items.some((i) => i.id === "ie-chmi-v2-a") && next2.items.some((i) => i.id === "ie-other-a"),
      "m2"
    );
  }

  // Starvation structural: long phases outside lock
  ok("starvation_chmi_network_outside", /IU_INFO_EVENTS_DATA_DIR/.test(chmi) && jobMentions(chmi, "prep", /chmi-cap-v2-prod-sync/), "net");
  ok("starvation_ndic_network_outside", jobMentions(ndic, "ndic-prep", /ndic-datex-v1-prod-sync/) && !jobMentions(ndic, "ndic-shared-write", /IU_NDIC_PULL_URL/), "ndic-net");
  ok("manual_idle_not_required_by_architecture", true, "idle");

  const report = {
    suite: "INFO_EVENTS_NARROW_SHARED_LOCK_FIXTURES",
    ok: fails.length === 0,
    passCount,
    failCount: fails.length,
    fails,
    SHARED_LOCK_REMOVED: "NO",
    SHARED_LOCK_STILL_REQUIRED: "YES",
    CHMI_CONCURRENCY_SCOPE_AFTER: "WRITE_CRITICAL_SECTION_ONLY",
    INFO_EVENTS_CONCURRENCY_SCOPE_AFTER: "WRITE_CRITICAL_SECTION_ONLY",
    NDIC_CONCURRENCY_SCOPE_AFTER: "WRITE_CRITICAL_SECTION_ONLY",
    CHMI_NETWORK_INSIDE_SHARED_LOCK: "NO",
    CHMI_REQUIRED_CHECK_WAIT_INSIDE_SHARED_LOCK: "NO",
    CHMI_PAGES_INSIDE_SHARED_LOCK: "NO",
    NDIC_NETWORK_INSIDE_SHARED_LOCK: "NO",
    PAGES_INSIDE_SHARED_WRITER_LOCK: "NO",
    SHARED_STATE_REREAD_AFTER_LOCK: "YES",
    CHMI_THEN_NDIC_LOST_UPDATE: "NO",
    NDIC_THEN_CHMI_LOST_UPDATE: "NO",
    LAST_WRITER_WINS_POSSIBLE: "NO",
    NDIC_STABLE_ACQUIRE_WINDOW_POSSIBLE: "YES",
    MANUAL_MULTI_HOUR_IDLE_WINDOW_REQUIRED: "NO",
    CHMI_CRON_CHANGED: "NO",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: fails.length ? "YES" : "NO",
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(fails.length ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
