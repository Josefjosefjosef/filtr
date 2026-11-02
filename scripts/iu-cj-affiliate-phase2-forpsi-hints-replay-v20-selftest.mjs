#!/usr/bin/env node
/**
 * V20 hints-replay selftest (mock transport) — does not mutate processedUids.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMockForpsiImapTransport } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import {
  runMailboxSyncBatch,
  runMailboxHintsReplayBatch,
  loadSyncState,
  defaultForpsiSyncStatePath,
  defaultForpsiSyncLockPath,
} from "./iu-cj-affiliate-phase2-forpsi-imap-sync-lib.mjs";

const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-hints-replay-"));
const statePath = defaultForpsiSyncStatePath(dir);
const lockPath = defaultForpsiSyncLockPath(dir);

const messages = [
  {
    uid: 10,
    from: "owner-membermessaging@mx6.cj.com",
    subject: "Welcome to GANT.CZ affiliate program",
    bodyText: "Partner approved. Fashion apparel clothing assortment. Advertiser 4978487.",
    sizeBytes: 200,
  },
  {
    uid: 11,
    from: "owner-membermessaging@mx6.cj.com",
    subject: "Čedok welcome",
    bodyText: "Travel vacation tour cestovní kancelář. Advertiser 6179554.",
    sizeBytes: 180,
  },
];

const transport1 = createMockForpsiImapTransport({ messages });
const sync = await runMailboxSyncBatch({
  transport: transport1,
  statePath,
  lockPath,
  ownerId: "sync-test",
  batchSize: 10,
  catalogAdvertisers: [
    { advertiserId: "4978487", advertiserName: "GANT.CZ" },
    { advertiserId: "6179554", advertiserName: "Čedok.cz" },
  ],
});
expect("initial_sync_ok", sync.ok === true, sync);
const afterSync = loadSyncState(statePath);
const processedBefore = [...(afterSync.processedUids || [])];
expect("processed_two", processedBefore.length >= 2, processedBefore);

const transport2 = createMockForpsiImapTransport({ messages });
const replay = await runMailboxHintsReplayBatch({
  transport: transport2,
  statePath,
  lockPath,
  ownerId: "replay-test",
  batchSize: 10,
  catalogAdvertisers: [
    { advertiserId: "4978487", advertiserName: "GANT.CZ" },
    { advertiserId: "6179554", advertiserName: "Čedok.cz" },
  ],
});
expect("replay_ok", replay.ok === true && replay.phase === "hints_replay", replay);
expect("replay_batch_results", (replay.batchResults || []).length >= 1, replay.batchResults);
const afterReplay = loadSyncState(statePath);
expect(
  "processed_uids_unchanged",
  JSON.stringify(afterReplay.processedUids) === JSON.stringify(processedBefore),
  { before: processedBefore, after: afterReplay.processedUids }
);
expect("has_excerpts", (replay.batchResults || []).some((r) => r.ok && r.excerptSafe), replay.batchResults);

// Second replay should complete with 0 pending (dedupe)
const transport3 = createMockForpsiImapTransport({ messages });
const replay2 = await runMailboxHintsReplayBatch({
  transport: transport3,
  statePath,
  lockPath,
  ownerId: "replay-test-2",
  batchSize: 10,
});
expect("replay_dedupe_complete", replay2.ok === true && replay2.batchSize === 0 && replay2.complete === true, replay2);

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, processedBefore, replayBatch: replay.batchSize }, null, 2));
