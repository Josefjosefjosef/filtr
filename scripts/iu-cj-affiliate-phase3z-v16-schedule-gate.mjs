#!/usr/bin/env node
/**
 * Phase 3Z V16 — prove post-V15 event=schedule automation (never arms PUBLIC_SWAP).
 * Exit 0 only when catalog-sync schedule SUCCESS exists on a SHA that contains V15 merge.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const V15_MERGE = "8e709557cf38b09a7a2316d6f693ce145b3b3b83";

function ghJson(args) {
  const out = execFileSync("gh", args, { encoding: "utf8", cwd: ROOT });
  return JSON.parse(out);
}

function isAncestor(ancestor, tip) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, tip], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

function listSchedule(workflow) {
  return ghJson([
    "run",
    "list",
    "--workflow",
    workflow,
    "--limit",
    "30",
    "--json",
    "databaseId,event,status,conclusion,headSha,createdAt,url,displayTitle",
  ]).filter((r) => r.event === "schedule");
}

const catalog = listSchedule("cj-affiliate-catalog-sync.yml");
const registry = listSchedule("cj-affiliate-phase3z-partner-registry.yml");

const catalogPost = catalog.filter(
  (r) => r.conclusion === "success" && isAncestor(V15_MERGE, r.headSha)
);
const registryPost = registry.filter(
  (r) => r.conclusion === "success" && isAncestor(V15_MERGE, r.headSha)
);

const report = {
  schema: "iu-affiliate-cj-phase3z-v16-schedule-gate",
  publicButtonSwapArmed: false,
  PUBLIC_SWAP: "DISARMED",
  v15MergeSha: V15_MERGE,
  SCHEDULED_POST_V15: catalogPost.length > 0 ? "PASS" : "PENDING",
  PARTNER_REGISTRY_SCHEDULE_POST_V15: registryPost.length > 0 ? "PASS" : "PENDING",
  catalogSyncLatestSchedule: catalog[0] || null,
  partnerRegistryLatestSchedule: registry[0] || null,
  catalogPostV15Success: catalogPost[0] || null,
  registryPostV15Success: registryPost[0] || null,
  swapAllowed: catalogPost.length > 0 && registryPost.length > 0,
  note:
    "Public swap must remain DISARMED until both catalog-sync and partner-registry have event=schedule SUCCESS on a post-V15 SHA. workflow_dispatch does not count.",
};

const outDir = process.env.TEMP || process.env.TMPDIR || "/tmp";
const outPath = path.join(outDir, "iu-v16-schedule-gate.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.swapAllowed ? 0 : 2);
