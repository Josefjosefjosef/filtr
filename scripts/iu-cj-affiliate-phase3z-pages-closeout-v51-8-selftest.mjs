#!/usr/bin/env node
/**
 * V51.8 — offline contract for offers promote Pages closeout.
 * Proves wait budget + deferred fallback markers exist (no live GH calls).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(join(root, ".github/workflows/cj-affiliate-catalog-sync.yml"), "utf8");
const pub = readFileSync(join(root, ".github/workflows/pages-publish-from-main-data.yml"), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(/timeout-minutes:\s*90/.test(wf), "promote job timeout-minutes must be 90");
assert(wf.includes("CLOSEOUT_POLL_MAX=180"), "poll max 180");
assert(wf.includes("CLOSEOUT_POLL_SLEEP_SEC=20"), "poll sleep 20s");
assert(wf.includes("seq 1 180"), "seq 1 180 loop");
assert(wf.includes("CLOSEOUT_DEFERRED=true"), "deferred marker");
assert(wf.includes("CLOSEOUT_PAGES_DISPATCHED=true"), "pages dispatched marker");
assert(
  wf.includes("gh workflow run pages-publish-from-main-data.yml"),
  "soft-timeout must dispatch pages-publish-from-main-data"
);
assert(wf.includes("gh workflow run pages.yml"), "merged path dispatches pages.yml");
assert(
  pub.includes("CJ Affiliate catalog sync"),
  "pages-publish workflow_run must include CJ catalog sync"
);
assert(pub.includes("main_offers_updatedAt"), "offers freshness compare");
assert(pub.includes("prod_offers_updatedAt"), "prod offers compare");

// Budget math: 180 * 20s = 3600s = 60m < job timeout 90m
const budgetSec = 180 * 20;
assert(budgetSec === 3600, "budget 60m");
assert(budgetSec < 90 * 60, "budget under job timeout");

console.log(
  JSON.stringify({
    IU_CJ_PAGES_CLOSEOUT_V51_8_SELFTEST: "PASS",
    promoteTimeoutMinutes: 90,
    pollMax: 180,
    pollSleepSec: 20,
    waitBudgetMinutes: budgetSec / 60,
    deferredFallback: "pages-publish-from-main-data.yml",
    mergedDispatch: "pages.yml",
  })
);
