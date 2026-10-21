#!/usr/bin/env node
/** E2E: GHA → mock IMAP → pipeline → mock AI → v15 → mock D1 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  runGithubActionsIngestCycle,
  processMessageThroughFullPipeline,
  INGEST_RUN_MODE,
} from "./iu-cj-affiliate-phase2-github-actions-ingest-lib.mjs";
import { buildSyntheticMime, FIXTURE_BEZVASPORT_CZ, FIXTURE_VIVANTIS_MULTI } from "./iu-cj-affiliate-phase2-forpsi-imap-fixtures.mjs";
import { parseRawMimeMessage } from "./iu-cj-affiliate-phase2-forpsi-mime-lib.mjs";
import { normalizeFetchedMessage } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import { buildHallucinatedAiPayload } from "./iu-cj-affiliate-phase2-ai-offer-evidence-validator.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

const results = [];

function record(id, pass, detail = null) {
  results.push({ id, pass: pass === true, detail });
}

const baseDir = path.join(os.tmpdir(), "iu-cj-gha-e2e-" + process.pid);
fs.mkdirSync(baseDir, { recursive: true });

const msgNew = {
  uid: 10,
  uidvalidity: 8001,
  subject: "New coupon",
  from: "owner-membermessaging@mx6.cj.com",
  bodyText: "Kupón SAVE20\nLINK ID: 1\nCID: 123456\nSleva 15 %",
};

const r1 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t1", "d1.json"),
  mockFixture: { messages: [msgNew] },
  mode: INGEST_RUN_MODE.periodic,
});
record(
  "e2e_new_message",
  r1.ok && r1.publishable === false && r1.pipelineResults?.[0]?.fromImapFetch === true
);

const histMsg = { uid: 1, uidvalidity: 8001, subject: "Old", bodyText: "Historická zpráva CID: 123456" };
const r2 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t2", "d1.json"),
  mockFixture: { messages: [histMsg] },
  mode: INGEST_RUN_MODE.historical,
  historicalBatchSize: 20,
});
record("e2e_historical_message", r2.ok && r2.mode === INGEST_RUN_MODE.historical);

const bezMsg = { uid: 11, uidvalidity: 8001, mailbox: "affiliate@infouzel.cz", folder: "INBOX", ...FIXTURE_BEZVASPORT_CZ };
const multi = processMessageThroughFullPipeline(bezMsg, { catalogAdvertisers: [{ advertiserId: "5277391" }] });
record("e2e_multi_offer_fixture", (multi.deterministic?.offers?.length || 0) >= 2 && multi.publishable === false);

const d3 = path.join(baseDir, "t3a", "d1.json");
const r3a = await runGithubActionsIngestCycle({ d1PersistPath: d3, mockFixture: { messages: [msgNew] } });
const r3b = await runGithubActionsIngestCycle({ d1PersistPath: d3, mockFixture: { messages: [msgNew] } });
const d3Store = await import("./iu-cj-affiliate-phase2-cj-email-d1-store.mjs").then((m) =>
  m.createCjEmailD1Store({ persistPath: d3 })
);
record(
  "e2e_repeat_workflow",
  r3a.ok && r3b.ok && r3b.fetchResult?.batchSize === 0 && d3Store.isUidCompleted(10) === true
);

const r4 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t4", "d1.json"),
  mockFixture: { messages: [msgNew] },
  simulateConcurrentRun: true,
});
record("e2e_concurrent_runs", r4.ok === false && r4.reason === "concurrent_run_blocked");

const r5 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t5", "d1.json"),
  mockFixture: { messages: [msgNew] },
  simulateImapFailure: true,
});
record("e2e_imap_failure", r5.ok === false && r5.reason === "imap_simulated_failure");

const r6 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t6", "d1.json"),
  mockFixture: { messages: [{ uid: 20, uidvalidity: 8001, bodyText: "nejasná poznámka bez kódu", subject: "?" }] },
  pipelineOptions: { forceAi: true, quota: { maxCallsPerDay: 0, callsUsed: 0 } },
});
record(
  "e2e_cf_ai_quota",
  r6.pipelineResults?.[0]?.lifecycle?.deferred === true ||
    r6.pipelineResults?.[0]?.lifecycle?.pipeline?.stage === "queued"
);

const r7 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t7", "d1.json"),
  mockFixture: { messages: [msgNew] },
  simulateD1FailureOnFinal: true,
});
record("e2e_d1_failure", r7.pipelineResults?.[0]?.lifecycle?.d1Error === "d1_write_simulated_failure");

const badMime = "Content-Type: text/plain\r\n\r\n" + "x".repeat(600 * 1024);
const badParsed = parseRawMimeMessage(badMime);
record("e2e_bad_mime", badParsed.ok === false);

const badAi = processMessageThroughFullPipeline(msgNew, {
  simulateAiPayload: buildHallucinatedAiPayload("fake_coupon"),
});
record("e2e_bad_ai_json", badAi.ai?.ok === false);

const pubAttempt = processMessageThroughFullPipeline(msgNew, {
  catalogAdvertisers: [{ advertiserId: "123456", relationshipStatus: "joined" }],
});
record(
  "e2e_no_unauthorized_publication",
  pubAttempt.publishable === false && pubAttempt.v15?.stagingPublishable === false
);

const r8 = await runGithubActionsIngestCycle({
  d1PersistPath: path.join(baseDir, "t8", "d1.json"),
  mockFixture: { messages: [msgNew, { uid: 12, uidvalidity: 8001, bodyText: "resume CID: 1" }] },
});
record("e2e_recovery_after_outage", r8.ok === true);

record("e2e_production_signing_off", PRODUCTION_SIGNING_ENABLED === false);

const viv = normalizeFetchedMessage({
  uid: 13,
  uidvalidity: 8001,
  subject: FIXTURE_VIVANTIS_MULTI.subject,
  bodyText: FIXTURE_VIVANTIS_MULTI.bodyText,
  from: FIXTURE_VIVANTIS_MULTI.from,
});
const vivP = processMessageThroughFullPipeline(viv);
record("e2e_vivantis_multi", (vivP.deterministic?.offers?.length || 0) >= 3);

const failed = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify({
    IU_CJ_GITHUB_ACTIONS_INGEST_E2E: failed === 0 ? "OK" : "FAIL",
    passed: results.length - failed,
    failed,
    results,
  })
);
process.exit(failed === 0 ? 0 : 1);
