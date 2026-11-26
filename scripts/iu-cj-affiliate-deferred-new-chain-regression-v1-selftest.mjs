#!/usr/bin/env node
/**
 * Selftest for iu-cj-affiliate-deferred-new-chain-regression-v1.mjs (offline, synthetic fixtures only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkChain } from "./iu-cj-affiliate-deferred-new-chain-regression-v1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "iu-cj-affiliate-deferred-new-chain-regression-v1.mjs");

const doc = (deferredNew) => ({
  snapshotId: "snap-1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  publicGrowthBudget: {
    publicEligibleAfter: 10,
    cumulativeAddedSinceBaseline: 500,
    exceptionalGrowthRequiresOwner: true,
    ...(deferredNew === undefined ? {} : { deferredNew }),
  },
  stats: { coupons: 1, actions: 2, partners: 3, products: 4, uniquePublicEligible: 10 },
});

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log("ok " + n + " " + name);
}

t("numeric deferredNew passes and prod-meta matches", () => {
  const r = checkChain(doc(294352));
  assert.equal(r.pass, true, JSON.stringify(r.problems));
  assert.equal(r.offersDeferredNew, 294352);
  assert.equal(r.prodMetaDeferredNew, 294352);
});

t("zero is a valid finite number", () => {
  assert.equal(checkChain(doc(0)).pass, true);
});

t("missing deferredNew FAILS (no silent coercion to 0)", () => {
  const r = checkChain(doc(undefined));
  assert.equal(r.pass, false);
  assert.ok(r.problems.some((p) => p.startsWith("OFFERS_DEFERRED_NEW_NOT_FINITE_NUMBER")));});

t("null / string / NaN / Infinity deferredNew FAIL", () => {
  for (const v of [null, "294352", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(checkChain(doc(v)).pass, false, String(v));
  }
});

t("missing publicGrowthBudget FAILS", () => {
  const r = checkChain({ snapshotId: "s", updatedAt: "x", stats: {} });
  assert.equal(r.pass, false);
  assert.ok(r.problems.includes("OFFERS_PUBLIC_GROWTH_BUDGET_MISSING"));
});

t("matrix liveSnapshot.deferredNew must be numeric and match offers", () => {
  assert.equal(checkChain(doc(294352), { liveSnapshot: { deferredNew: 294352 } }).pass, true);
  const stale = checkChain(doc(294352), { liveSnapshot: { deferredNew: 297325 } });
  assert.equal(stale.pass, false);
  assert.ok(stale.problems.some((p) => p.startsWith("MATRIX_DEFERRED_NEW_STALE")));
  const nul = checkChain(doc(294352), { liveSnapshot: { deferredNew: null } });
  assert.equal(nul.pass, false);
  assert.ok(nul.problems.some((p) => p.startsWith("MATRIX_DEFERRED_NEW_NOT_FINITE_NUMBER")));
});

t("CLI exit codes: pass=0, fail=1, unreadable=2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-dn-chain-selftest-"));
  try {
    const okP = path.join(dir, "ok.json");
    const badP = path.join(dir, "bad.json");
    fs.writeFileSync(okP, JSON.stringify(doc(294352)));
    fs.writeFileSync(badP, JSON.stringify(doc(undefined)));
    const env = { ...process.env };
    delete env.IU_CJ_MASTER_MATRIX_PATH;
    const ok = spawnSync(process.execPath, [CLI, "--offers", okP], { env, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /DEFERRED_NEW_CHAIN=PASS/);
    const ko = spawnSync(process.execPath, [CLI, "--offers", badP], { env, encoding: "utf8" });
    assert.equal(ko.status, 1, ko.stdout + ko.stderr);
    assert.match(ko.stdout, /DEFERRED_NEW_CHAIN=FAIL/);
    const none = spawnSync(process.execPath, [CLI, "--offers", path.join(dir, "nope.json")], { env, encoding: "utf8" });
    assert.equal(none.status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("iu-cj-affiliate-deferred-new-chain-regression-v1 selftest PASS (" + n + " checks)");
