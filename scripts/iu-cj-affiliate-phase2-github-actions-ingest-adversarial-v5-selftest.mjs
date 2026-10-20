#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGithubActionsIngestCycle, resolveIngestRuntimeConfig } from "./iu-cj-affiliate-phase2-github-actions-ingest-lib.mjs";
import { createCjEmailD1Store } from "./iu-cj-affiliate-phase2-cj-email-d1-store.mjs";
import { processMessageThroughFullPipeline } from "./iu-cj-affiliate-phase2-github-actions-ingest-pipeline.mjs";
import { buildHallucinatedAiPayload } from "./iu-cj-affiliate-phase2-ai-offer-evidence-validator.mjs";
import { FIXTURE_SEPHORA_RHODE_BAN, FIXTURE_VIVANTIS_MULTI } from "./iu-cj-affiliate-phase2-forpsi-imap-fixtures.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { LIFECYCLE_HOOK } from "./iu-cj-affiliate-phase2-message-lifecycle.mjs";

const baseDir = path.join(os.tmpdir(), "iu-cj-adv-v5-" + process.pid);
fs.mkdirSync(baseDir, { recursive: true });

const results = [];
function record(id, pass, detail = null) {
  results.push({ id, pass, detail });
}

const msg = {
  uid: 1,
  uidvalidity: 7001,
  bodyText: "Kupón SAVE20\nCID: 123456\nLINK ID: 1",
  subject: "T",
};
const d1 = path.join(baseDir, "d1.json");

record(
  "adv_imap_interrupt",
  (
    await runGithubActionsIngestCycle({
      d1PersistPath: d1 + ".1",
      mockFixture: { messages: [msg] },
      failAfterStage: LIFECYCLE_HOOK.after_fetch,
    })
  ).ok === false && !createCjEmailD1Store({ persistPath: d1 + ".1" }).isUidCompleted(1)
);

record(
  "adv_d1_before_raw",
  (
    await runGithubActionsIngestCycle({
      d1PersistPath: d1 + ".2",
      mockFixture: { messages: [msg] },
      simulateD1FailureOnRaw: true,
    })
  ).pipelineResults?.[0]?.lifecycle?.recoverable === true
);

record(
  "adv_before_classify",
  (
    await runGithubActionsIngestCycle({
      d1PersistPath: d1 + ".3",
      mockFixture: { messages: [msg] },
      failAfterStage: LIFECYCLE_HOOK.after_raw_persist,
    })
  ).ok === false
);

record(
  "adv_during_ai",
  (
    await runGithubActionsIngestCycle({
      d1PersistPath: d1 + ".4",
      mockFixture: { messages: [{ ...msg, uid: 2, bodyText: "note" }] },
      pipelineOptions: { forceAi: true },
      failAfterStage: LIFECYCLE_HOOK.during_ai,
    })
  ).ok === false
);

const d1FinalRun = await runGithubActionsIngestCycle({
  d1PersistPath: d1 + ".5",
  mockFixture: { messages: [{ ...msg, uid: 55 }] },
  simulateD1FailureOnFinal: true,
});
record(
  "adv_d1_final",
  d1FinalRun.pipelineResults?.[0]?.lifecycle?.d1Error === "d1_write_simulated_failure" &&
    createCjEmailD1Store({ persistPath: d1 + ".5" }).isUidCompleted(55) === false
);

const restartD1 = d1 + ".restart";
await runGithubActionsIngestCycle({ d1PersistPath: restartD1, mockFixture: { messages: [msg] }, failAfterStage: LIFECYCLE_HOOK.before_final_persist });
record("adv_empty_runner_restart", !createCjEmailD1Store({ persistPath: restartD1 }).isUidCompleted(1));
record(
  "adv_empty_runner_recovery",
  (await runGithubActionsIngestCycle({ d1PersistPath: restartD1, mockFixture: { messages: [msg] } })).ok === true
);

record(
  "adv_concurrent",
  (await runGithubActionsIngestCycle({ d1PersistPath: d1 + ".c", mockFixture: { messages: [msg] }, simulateConcurrentRun: true })).reason ===
    "concurrent_run_blocked"
);

const dupD1 = d1 + ".dup";
await runGithubActionsIngestCycle({ d1PersistPath: dupD1, mockFixture: { messages: [{ ...msg, uid: 88 }] } });
const dup2 = await runGithubActionsIngestCycle({ d1PersistPath: dupD1, mockFixture: { messages: [{ ...msg, uid: 88 }] } });
record(
  "adv_duplicate_delivery",
  dup2.ok === true && dup2.fetchResult?.batchSize === 0 && createCjEmailD1Store({ persistPath: dupD1 }).isUidCompleted(88) === true
);

const uvD1 = d1 + ".uv";
await runGithubActionsIngestCycle({ d1PersistPath: uvD1, mockFixture: { messages: [{ ...msg, uidvalidity: 1 }] } });
const persistedUv = JSON.parse(fs.readFileSync(uvD1, "utf8"));
persistedUv.run_leases = {};
fs.writeFileSync(uvD1, JSON.stringify(persistedUv));
const storeUv = createCjEmailD1Store({ persistPath: uvD1 });
storeUv.acquireRunLease("adv-uv");
const cpUv = storeUv.getSyncCheckpoint();
const prevUv = cpUv.uidvalidity != null ? Number(cpUv.uidvalidity) : null;
const nextUv = (prevUv ?? 1) + 1;
const uvReset = storeUv.applyUidValidityChange(nextUv, prevUv, { runId: "adv-uv", expectedPreviousUidvalidity: prevUv });
record("adv_uidvalidity_reset", uvReset?.ok === true && storeUv.getSyncCheckpoint().completedUids.length === 0);

record("adv_d1_outage", (await runGithubActionsIngestCycle({ d1PersistPath: d1 + ".d1", mockFixture: { messages: [msg] }, simulateD1FailureOnFinal: true })).ok === false);

record("adv_imap_down", (await runGithubActionsIngestCycle({ d1PersistPath: d1 + ".imap", mockFixture: { messages: [msg] }, simulateImapFailure: true })).ok === false);

const aiQuotaRun = await runGithubActionsIngestCycle({
  d1PersistPath: d1 + ".ai",
  mockFixture: { messages: [{ uid: 3, uidvalidity: 7001, bodyText: "?" }] },
  pipelineOptions: { forceAi: true, quota: { maxCallsPerDay: 0, callsUsed: 0 } },
});
record(
  "adv_ai_quota",
  aiQuotaRun.pipelineResults?.[0]?.lifecycle?.deferred === true &&
    createCjEmailD1Store({ persistPath: d1 + ".ai" }).isUidCompleted(3) === false
);

record(
  "adv_no_offer",
  (await runGithubActionsIngestCycle({ d1PersistPath: d1 + ".no", mockFixture: { messages: [{ uid: 4, uidvalidity: 7001, bodyText: "hello" }] } })).publishable === false
);

const multi = await runGithubActionsIngestCycle({
  d1PersistPath: d1 + ".multi",
  mockFixture: {
    messages: [
      {
        uid: 5,
        uidvalidity: 7001,
        subject: FIXTURE_VIVANTIS_MULTI.subject,
        from: FIXTURE_VIVANTIS_MULTI.from,
        bodyText: FIXTURE_VIVANTIS_MULTI.bodyText,
      },
    ],
  },
});
record(
  "adv_multi_offer",
  (multi.pipelineResults?.[0]?.lifecycle?.pipeline?.deterministic?.offers?.length || 0) >= 3 && multi.publishable === false
);

const ban = processMessageThroughFullPipeline({ uid: 6, uidvalidity: 1, ...FIXTURE_SEPHORA_RHODE_BAN }, {});
record("adv_v15_ban", ban.v15?.stagingPublishable === false && ban.publishable === false);

const hall = processMessageThroughFullPipeline(msg, { simulateAiPayload: buildHallucinatedAiPayload("fake_grant") });
record("adv_ai_fake_grant", hall.ai?.ok === false || hall.publishable === false);

const cfgBlocked = resolveIngestRuntimeConfig({ IU_CJ_EMAIL_INGEST_OFFLINE: "0" });
record("adv_live_without_approval", cfgBlocked.liveImapAllowed === false);

record("adv_signing_off", PRODUCTION_SIGNING_ENABLED === false);

const failed = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify({
    IU_CJ_GITHUB_ACTIONS_INGEST_ADVERSARIAL_V5: failed === 0 ? "OK" : "FAIL",
    passed: results.length - failed,
    failed,
    results,
  })
);
process.exit(failed === 0 ? 0 : 1);
