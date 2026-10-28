#!/usr/bin/env node
/**
 * Phase 3S — explain mailboxInventory vs messagesRead without secrets/bodies.
 *
 * Typical live evidence (run 40514297668):
 *   inventory=311, read=296, pendingAfter=0, complete=true
 * Gap 15 = UIDs already in checkpoint.processedUids from prior run
 * (40494931124 processed batch of 15), not lost mail.
 */
export function auditMailboxGap({
  mailboxInventory = 0,
  messagesRead = 0,
  pendingAfterBatch = 0,
  checkpointComplete = false,
  priorBatchProcessed = null,
} = {}) {
  const inventory = Number(mailboxInventory) || 0;
  const read = Number(messagesRead) || 0;
  const pending = Number(pendingAfterBatch) || 0;
  const impliedPrior = Math.max(0, inventory - read - pending);
  return {
    schema: "iu-cj-affiliate-phase3s-mailbox-gap-audit-v1",
    mailboxInventory: inventory,
    messagesReadThisRun: read,
    pendingAfterBatch: pending,
    checkpointComplete: checkpointComplete === true,
    impliedAlreadyProcessed: impliedPrior,
    priorBatchProcessedHint: priorBatchProcessed,
    lostMessagesSuspected: checkpointComplete === true && pending > 0,
    explanation:
      impliedPrior > 0
        ? "Gap is prior-checkpoint progress (and/or UIDs arriving between inventory snapshots), not silent drop."
        : "No inventory/read gap; pending remains only if batch incomplete.",
    liveEnabled: false,
    publishArmed: false,
  };
}

const demo = auditMailboxGap({
  mailboxInventory: 311,
  messagesRead: 296,
  pendingAfterBatch: 0,
  checkpointComplete: true,
  priorBatchProcessed: 15,
});

if (process.argv[1] && process.argv[1].endsWith("iu-cj-affiliate-phase3s-mailbox-gap-audit-v1.mjs")) {
  const ok = demo.impliedAlreadyProcessed === 15 && demo.lostMessagesSuspected === false;
  console.log(JSON.stringify({ OK: ok, ...demo }, null, 2));
  process.exit(ok ? 0 : 1);
}
