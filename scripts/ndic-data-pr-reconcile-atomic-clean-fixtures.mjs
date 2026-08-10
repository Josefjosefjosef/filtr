#!/usr/bin/env node
/**
 * Atomic tip-equality merge-clean fixtures (CHMI_MAIN_TIP_RACE_VS_BOUNDED_RECONCILE).
 *
 * Guards against shallow rev-list / merge-base false unclean that exhausts
 * DATA_PR_REFRESH_MAX while origin/main tip is stable (schedule run 31369423212).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateStableTipMergeClean,
  tipMoveTouchesInfoEvents,
} from "./ndic-data-pr-reconcile-against-main.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECONCILE = path.join(ROOT, "scripts", "ndic-data-pr-reconcile-against-main.mjs");

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (cond) passCount += 1;
  else fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

const tip = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ndic = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const moved = "cccccccccccccccccccccccccccccccccccccccc";

{
  const v = evaluateStableTipMergeClean({
    tipSha: tip,
    baseSha: tip,
    headSha: tip,
    parentSha: "",
    workingTreeClean: true,
  });
  ok("stable_tip_no_changes_clean", v.clean === true && v.reason === "HEAD_EQUALS_STABLE_TIP");
}
{
  const v = evaluateStableTipMergeClean({
    tipSha: tip,
    baseSha: tip,
    headSha: ndic,
    parentSha: tip,
    workingTreeClean: true,
  });
  ok("stable_tip_committed_clean", v.clean === true && v.reason === "PARENT_EQUALS_STABLE_TIP");
}
{
  const v = evaluateStableTipMergeClean({
    tipSha: tip,
    baseSha: tip,
    headSha: ndic,
    parentSha: tip,
    workingTreeClean: false,
  });
  ok("dirty_worktree_unclean", v.clean === false && v.reason === "DIRTY_WORKTREE");
}
{
  const v = evaluateStableTipMergeClean({
    tipSha: moved,
    baseSha: tip,
    headSha: ndic,
    parentSha: tip,
    workingTreeClean: true,
  });
  ok("tip_moved_unclean", v.clean === false && v.reason === "TIP_MOVED");
}
{
  const v = evaluateStableTipMergeClean({
    tipSha: tip,
    baseSha: tip,
    headSha: ndic,
    parentSha: moved,
    workingTreeClean: true,
  });
  ok("orphan_head_unclean", v.clean === false && v.reason === "HEAD_NOT_BASED_ON_TIP");
}
{
  const v = evaluateStableTipMergeClean({
    tipSha: "",
    baseSha: tip,
    headSha: tip,
    workingTreeClean: true,
  });
  ok("missing_sha_unclean", v.clean === false && v.reason === "MISSING_SHA");
}

ok(
  "ie_touch_true",
  tipMoveTouchesInfoEvents([
    "projects/data/info_events/feed.json",
    "projects/data/chmi_cap_v2/snapshot.json",
  ]) === true
);
ok(
  "ie_touch_false_chmi_only",
  tipMoveTouchesInfoEvents(["projects/data/chmi_cap_v2/snapshot.json"]) === false
);

const src = fs.readFileSync(RECONCILE, "utf8");
ok("source_exports_evaluate", /export function evaluateStableTipMergeClean/.test(src));
ok("source_uses_evaluate", /evaluateStableTipMergeClean\(/.test(src));
ok(
  "source_no_shallow_revlist_default_behind",
  !/behind\.stdout \|\| "1"/.test(src) && !/rev-list", "--count", "HEAD\.\.origin\/main"/.test(src)
);
ok("source_flags_atomic", /ATOMIC_TIP_EQUALITY_CLEAN_CHECK:\s*"YES"/.test(src));
ok(
  "source_forensic_tip_race_log",
  /CHMI_MAIN_TIP_RACE_VS_BOUNDED_RECONCILE/.test(src)
);

console.log(
  JSON.stringify({
    ok: fails.length === 0,
    passCount,
    failCount: fails.length,
    fails,
  })
);
process.exit(fails.length === 0 ? 0 : 1);
