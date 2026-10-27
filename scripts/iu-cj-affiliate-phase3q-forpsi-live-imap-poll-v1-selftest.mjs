#!/usr/bin/env node
/**
 * Phase 3Q Forpsi live IMAP poll selftest (offline mock; DISARMED).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  runForpsiLiveImapPoll,
  buildHintsFromBatchResults,
} from "./iu-cj-affiliate-phase3q-forpsi-live-imap-poll-v1.mjs";
import { assertReadOnlyImapCommand } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-phase3q-imap-"));
const checkpointA = path.join(tmpRoot, "cp-a");
const checkpointB = path.join(tmpRoot, "cp-b");

// Read-only command guard
expect("block_store", assertReadOnlyImapCommand("UID STORE 1 +FLAGS (\\Seen)").ok === false);
expect("block_expunge", assertReadOnlyImapCommand("EXPUNGE").ok === false);
expect("allow_examine", assertReadOnlyImapCommand("EXAMINE INBOX").ok === true);
expect("allow_peek", assertReadOnlyImapCommand("UID FETCH 1 BODY.PEEK[]").ok === true);

// Gate blocked without approval
const prevApproved = process.env.IU_FORPSI_IMAP_CONNECT_APPROVED;
const prevUser = process.env.IU_FORPSI_IMAP_USER;
const prevSecret = process.env.IU_FORPSI_IMAP_SECRET;
delete process.env.IU_FORPSI_IMAP_CONNECT_APPROVED;
delete process.env.IU_FORPSI_IMAP_USER;
delete process.env.IU_FORPSI_IMAP_SECRET;
const blocked = await runForpsiLiveImapPoll({ checkpointDir: checkpointA });
expect("blocked_without_approval", blocked.ok === false && blocked.status === "BLOCKED");
expect("blocked_exit", blocked.exitCode === 1);
expect("blocked_no_false_connect", blocked.imapConnected === false && blocked.authSuccess === false);

// Mock zero messages
process.env.IU_FORPSI_IMAP_CONNECT_APPROVED = "1";
process.env.IU_FORPSI_IMAP_USER = "affiliate@infouzel.cz";
process.env.IU_FORPSI_IMAP_SECRET = "test-secret-not-real";
const zero = await runForpsiLiveImapPoll({
  forceMock: true,
  checkpointDir: checkpointA,
  mockFixture: { messages: [], uidvalidity: 42 },
  ownerId: "selftest-zero",
});
expect("zero_ok", zero.ok === true && zero.mode === "mock");
expect("zero_checked", zero.messagesChecked === 0);
expect("zero_hints", zero.relevantHints === 0);
expect("zero_checkpoint", zero.checkpoint?.complete === true);

// Mock relevant messages + dedupe on second poll
const fixtureMsgs = [
  {
    uid: 1,
    uidvalidity: 42,
    subject: "Program approval — PartnerX",
    from: "owner-membermessaging@mx6.cj.com",
    bodyText: "Welcome to the program\nCID: 6466592\napproved",
  },
  {
    uid: 2,
    uidvalidity: 42,
    subject: "Program terminated — PartnerY",
    from: "owner-membermessaging@mx6.cj.com",
    bodyText: "Your relationship has been terminated\nCID: 111",
  },
  {
    uid: 3,
    uidvalidity: 42,
    subject: "New coupon SAVE10",
    from: "owner-membermessaging@mx6.cj.com",
    bodyText: "Kupón SAVE10\nLINK ID: 12345\nCID: 6466592",
  },
];
const first = await runForpsiLiveImapPoll({
  forceMock: true,
  checkpointDir: checkpointB,
  mockFixture: { messages: fixtureMsgs, uidvalidity: 42 },
  ownerId: "selftest-first",
  batchSize: 15,
});
expect("first_ok", first.ok === true);
expect("first_checked", first.messagesChecked === 3);
expect("first_batch", first.messagesInBatch === 3);
expect("first_hints_nonzero", first.relevantHints >= 1);
expect(
  "hints_require_cj",
  (first.hints || []).every(
    (h) => h.mutate === false && /EMAIL_HINT_REQUIRES_CJ_RECONCILE/.test(String(h.lifecycleAction))
  )
);

const second = await runForpsiLiveImapPoll({
  forceMock: true,
  checkpointDir: checkpointB,
  mockFixture: { messages: fixtureMsgs, uidvalidity: 42 },
  ownerId: "selftest-second",
  batchSize: 15,
});
expect("second_ok", second.ok === true);
expect("second_zero_new_batch", second.messagesInBatch === 0);
expect("second_complete", second.checkpoint?.complete === true);

// Hint builder unit
const hints = buildHintsFromBatchResults([
  { uid: 9, ok: true, categories: ["program_approval"] },
  { uid: 10, ok: false, categories: ["coupon"] },
]);
expect("hint_builder_one", hints.length === 1 && hints[0].uid === 9);
expect("hint_no_mutate", hints[0].mutate === false && hints[0].requiresCjApi === true);

// Restore env
if (prevApproved == null) delete process.env.IU_FORPSI_IMAP_CONNECT_APPROVED;
else process.env.IU_FORPSI_IMAP_CONNECT_APPROVED = prevApproved;
if (prevUser == null) delete process.env.IU_FORPSI_IMAP_USER;
else process.env.IU_FORPSI_IMAP_USER = prevUser;
if (prevSecret == null) delete process.env.IU_FORPSI_IMAP_SECRET;
else process.env.IU_FORPSI_IMAP_SECRET = prevSecret;

try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  /* ignore */
}

const out = {
  OK: failures.length === 0,
  schema: "iu-cj-affiliate-phase3q-forpsi-live-imap-poll-v1-selftest",
  liveEnabled: false,
  publishArmed: false,
  failures,
  samples: {
    blocked: blocked.status,
    zeroMessages: zero.messagesChecked,
    firstHints: first.relevantHints,
    secondBatch: second.messagesInBatch,
  },
};
console.log(JSON.stringify(out, null, 2));
process.exit(failures.length ? 1 : 0);
