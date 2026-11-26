#!/usr/bin/env node
/**
 * Selftest: persist FULL deferredNew keys + reload + set-diff.
 * Fixtures only — no live CJ API.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  persistDeferredNewKeys,
  loadDeferredNewKeySet,
  normalizeDeferredNewKeys,
  DEFERRED_NEW_LEDGER_FILENAME,
  DEFERRED_NEW_KEYS_JSONL_GZ,
  DEFERRED_NEW_KEYS_META_FILENAME,
} from "./iu-cj-affiliate-deferred-new-keys-persist-v51-8.mjs";
import { reconcileDeferredLedgerDelta } from "./iu-cj-affiliate-deferred-ledger-delta-v51-8.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-deferred-keys-"));
const dataDir = path.join(tmp, "data");
const auditDir = path.join(tmp, "audits");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(auditDir, { recursive: true });

const histKeys = ["1|a", "1|b", "1|c", "2|d", "2|e", "9|histOnly"];
const curKeys = ["1|a", "1|b", "1|c", "2|d", "2|e", "7|newOnly", "7|new2"];
// hist 6, cur 7 → declaredDelta = -1; left=1 (9|histOnly), entered=2 → identityNet=-1

const histPath = path.join(tmp, "hist-ledger.json");
fs.writeFileSync(
  histPath,
  JSON.stringify(
    {
      schema: "iu-affiliate-cj-deferred-new-ledger-v51",
      updatedAt: "2026-01-01T00:00:00Z",
      runId: "HIST",
      deferredNewCount: histKeys.length,
      keys: histKeys,
    },
    null,
    2
  ),
  "utf8"
);

const persisted = await persistDeferredNewKeys(curKeys, {
  dataDir,
  auditDir,
  runId: "SELFTEST",
  reason: "PER_RUN_GROWTH_BUDGET",
  preferredCurrency: "CZK",
  nowIso: "2026-11-26T12:00:00.000Z",
});

assert.equal(persisted.ok, true);
assert.equal(persisted.keyCount, curKeys.length);
assert.ok(fs.existsSync(persisted.ledgerPath));
assert.ok(fs.existsSync(persisted.jsonlGzPath));
assert.ok(fs.existsSync(persisted.metaPath));
assert.equal(persisted.publicGrowthBudgetPatch.deferredNewKeysPersistedSidecar, true);
assert.equal(persisted.publicGrowthBudgetPatch.deferredNewKeysPersistedInOffers, false);
assert.equal(persisted.publicGrowthBudgetPatch.deferredNewKeysForPublicPages, false);
assert.ok(persisted.auditCopy);

const fromLedger = await loadDeferredNewKeySet(persisted.ledgerPath, { preferGz: false });
assert.equal(fromLedger.uniqueCount, curKeys.length);
for (const k of curKeys) assert.ok(fromLedger.keys.has(k), `ledger missing ${k}`);

const fromGz = await loadDeferredNewKeySet(persisted.jsonlGzPath);
assert.equal(fromGz.uniqueCount, curKeys.length);

const fromDir = await loadDeferredNewKeySet(dataDir);
assert.equal(fromDir.uniqueCount, curKeys.length);

const fromMeta = await loadDeferredNewKeySet(persisted.metaPath);
assert.equal(fromMeta.uniqueCount, curKeys.length);

const auditLedger = path.join(auditDir, DEFERRED_NEW_LEDGER_FILENAME);
assert.ok(fs.existsSync(auditLedger));
assert.ok(fs.existsSync(path.join(auditDir, DEFERRED_NEW_KEYS_JSONL_GZ)));
assert.ok(fs.existsSync(path.join(auditDir, DEFERRED_NEW_KEYS_META_FILENAME)));

const delta = await reconcileDeferredLedgerDelta({
  historicalLedger: histPath,
  currentKeys: dataDir,
});
assert.equal(delta.reconcilable, true);
assert.equal(delta.status, "RECONCILED_PER_IDENTITY");
assert.equal(delta.declaredDelta, histKeys.length - curKeys.length);
assert.equal(delta.identityLevel.leftHistoricalCount, 1);
assert.equal(delta.identityLevel.enteredCurrentCount, 2);
assert.equal(delta.identityLevel.unexplainedResidual, 0);
assert.equal(delta.identityLevel.declaredDeltaMatchesIdentityNet, true);
assert.ok(delta.leftHistoricalSample.includes("9|histOnly"));
assert.ok(delta.enteredCurrentSample.includes("7|newOnly"));

const blocked = await reconcileDeferredLedgerDelta({
  historicalLedger: histPath,
  currentKeys: path.join(tmp, "missing-current"),
});
assert.equal(blocked.reconcilable, false);
assert.equal(blocked.status, "WAITING_NEXT_DISARMED_SYNC_FOR_CURRENT_KEYS");

const deduped = normalizeDeferredNewKeys(["1|a", "1|a", "", "|", null, "2|b"]);
assert.deepEqual(deduped, ["1|a", "2|b"]);

// Large-ish fixture (stream path): 5k keys persist + reload
const big = Array.from({ length: 5000 }, (_, i) => `adv|p${i}`);
const bigDir = path.join(tmp, "big");
const bigPersisted = await persistDeferredNewKeys(big, { dataDir: bigDir, runId: "BIG" });
assert.equal(bigPersisted.keyCount, 5000);
const bigLoad = await loadDeferredNewKeySet(bigDir);
assert.equal(bigLoad.uniqueCount, 5000);

const ledgerHash = crypto.createHash("sha256").update(fs.readFileSync(persisted.ledgerPath)).digest("hex");
assert.equal(persisted.meta.ledgerSha256, ledgerHash);
assert.equal(persisted.meta.generation, 1);
fs.writeFileSync(persisted.ledgerPath + ".partial", "{ partial");
const duringInterrupt = await loadDeferredNewKeySet(persisted.ledgerPath, { preferGz: false });
assert.equal(duringInterrupt.uniqueCount, curKeys.length);
fs.rmSync(persisted.ledgerPath + ".partial", { force: true });
let staleRefused = false;
try {
  await persistDeferredNewKeys(["9|overwrite"], {
    dataDir,
    runId: "STALE",
    expectedGeneration: 0,
  });
} catch (err) {
  staleRefused = err && err.code === "STALE_DEFERRED_SIDECAR";
}
assert.equal(staleRefused, true);
const afterStale = await loadDeferredNewKeySet(dataDir);
assert.equal(afterStale.uniqueCount, curKeys.length);
assert.ok(afterStale.keys.has("7|newOnly"));
assert.equal(afterStale.keys.has("9|overwrite"), false);

console.log(
  JSON.stringify({
    IU_CJ_DEFERRED_NEW_KEYS_PERSIST_V51_8_SELFTEST: "PASS",
    keyCount: persisted.keyCount,
    ledgerBytes: persisted.meta.ledgerBytes,
    jsonlGzBytes: persisted.meta.jsonlGzBytes,
    reconcilable: delta.reconcilable,
    declaredDelta: delta.declaredDelta,
    bigUnique: bigLoad.uniqueCount,
    tmp,
  })
);
