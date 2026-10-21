#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGithubActionsIngestCycle, resolveIngestRuntimeConfig, INGEST_RUN_MODE } from "./iu-cj-affiliate-phase2-github-actions-ingest-lib.mjs";
import { createCjEmailD1Store } from "./iu-cj-affiliate-phase2-cj-email-d1-store.mjs";
import { invokeD1WorkerRpc, resolveD1WorkerConfig, verifyWorkerRequestSignature } from "./iu-cj-affiliate-phase2-cj-email-d1-worker-client.mjs";
import { classifyAffiliateEmailWithAi, resolveWorkersAiConfig } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";
import { probeCjPatFormat, resolveCjApiConfig } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import { mockInvalidCjTokenResponse } from "./iu-cj-affiliate-phase2-cj-api-adapter-mock.mjs";
import { processMessageThroughFullPipeline } from "./iu-cj-affiliate-phase2-github-actions-ingest-pipeline.mjs";
import { buildHallucinatedAiPayload } from "./iu-cj-affiliate-phase2-ai-offer-evidence-validator.mjs";
import { FIXTURE_SEPHORA_RHODE_BAN, FIXTURE_VIVANTIS_MULTI } from "./iu-cj-affiliate-phase2-forpsi-imap-fixtures.mjs";
import { LIFECYCLE_HOOK } from "./iu-cj-affiliate-phase2-message-lifecycle.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { parseRawMimeMessage } from "./iu-cj-affiliate-phase2-forpsi-mime-lib.mjs";

const baseDir = path.join(os.tmpdir(), "iu-cj-int-v6-" + process.pid);
fs.mkdirSync(baseDir, { recursive: true });

const msg = {
  uid: 11,
  uidvalidity: 8001,
  subject: "T",
  bodyText: "Kupón SAVE20\nCID: 123456\nLINK ID: 1",
};

function d1Path(suffix) {
  return path.join(baseDir, "d1-" + suffix + ".json");
}

const results = [];

async function main() {
  results.push({
    id: "int_first_fetch",
    pass:
      (await runGithubActionsIngestCycle({ d1PersistPath: d1Path("1"), mockFixture: { messages: [msg] } })).pipelineResults?.[0]
        ?.lifecycle?.stage === "completed",
  });

  const dupPath = d1Path("2");
  await runGithubActionsIngestCycle({ d1PersistPath: dupPath, mockFixture: { messages: [msg] } });
  const dup2 = await runGithubActionsIngestCycle({ d1PersistPath: dupPath, mockFixture: { messages: [msg] } });
  results.push({
    id: "int_duplicate_fetch",
    pass: dup2.fetchResult?.batchSize === 0 && createCjEmailD1Store({ persistPath: dupPath }).isUidCompleted(11),
  });

  const r3 = await runGithubActionsIngestCycle({
    d1PersistPath: d1Path("3"),
    mockFixture: { messages: [msg] },
    simulateD1FailureOnRaw: true,
  });
  results.push({
    id: "int_d1_before_save",
    pass: r3.pipelineResults?.[0]?.lifecycle?.recoverable === true && !createCjEmailD1Store({ persistPath: d1Path("3") }).isUidCompleted(11),
  });

  results.push({
    id: "int_d1_during_save",
    pass:
      (
        await runGithubActionsIngestCycle({
          d1PersistPath: d1Path("4"),
          mockFixture: { messages: [msg] },
          failAfterStage: LIFECYCLE_HOOK.before_raw_persist,
        })
      ).ok === false,
  });

  const p5 = d1Path("5");
  await runGithubActionsIngestCycle({
    d1PersistPath: p5,
    mockFixture: { messages: [msg] },
    failAfterStage: LIFECYCLE_HOOK.after_raw_persist,
  });
  results.push({
    id: "int_after_save_before_ai",
    pass: !createCjEmailD1Store({ persistPath: p5 }).isUidCompleted(11),
  });

  results.push({
    id: "int_during_ai",
    pass:
      (
        await runGithubActionsIngestCycle({
          d1PersistPath: d1Path("6"),
          mockFixture: { messages: [msg] },
          pipelineOptions: { forceAi: true },
          failAfterStage: LIFECYCLE_HOOK.during_ai,
        })
      ).ok === false,
  });

  const p7 = d1Path("7");
  await runGithubActionsIngestCycle({
    d1PersistPath: p7,
    mockFixture: { messages: [msg] },
    failAfterStage: LIFECYCLE_HOOK.before_final_persist,
  });
  results.push({
    id: "int_before_finalize",
    pass: !createCjEmailD1Store({ persistPath: p7 }).isUidCompleted(11),
  });

  const restartPath = d1Path("8");
  await runGithubActionsIngestCycle({
    d1PersistPath: restartPath,
    mockFixture: { messages: [msg] },
    failAfterStage: LIFECYCLE_HOOK.after_classified,
  });
  results.push({
    id: "int_gha_restart",
    pass:
      (await runGithubActionsIngestCycle({ d1PersistPath: restartPath, mockFixture: { messages: [msg] } })).pipelineResults?.[0]
        ?.lifecycle?.stage === "completed",
  });

  results.push({
    id: "int_concurrent",
    pass:
      (
        await runGithubActionsIngestCycle({
          d1PersistPath: d1Path("9"),
          mockFixture: { messages: [msg] },
          simulateConcurrentRun: true,
        })
      ).phase === "concurrency",
  });

  const p10 = d1Path("10");
  const batch = [];
  for (let u = 20; u < 25; u++) batch.push({ ...msg, uid: u });
  const hist = { mode: INGEST_RUN_MODE.historical, historicalBatchSize: 2 };
  const r10a = await runGithubActionsIngestCycle({
    d1PersistPath: p10,
    mockFixture: { messages: batch },
    ...hist,
  });
  const r10b = await runGithubActionsIngestCycle({
    d1PersistPath: p10,
    mockFixture: { messages: batch },
    ...hist,
  });
  results.push({ id: "int_missed_hour_catchup", pass: r10a.fetchResult?.batchSize === 2 && r10b.fetchResult?.batchSize === 2 });

  const p11 = d1Path("11");
  const many = [];
  for (let u = 30; u < 36; u++) many.push({ ...msg, uid: u });
  const hist3 = { mode: INGEST_RUN_MODE.historical, historicalBatchSize: 3 };
  await runGithubActionsIngestCycle({ d1PersistPath: p11, mockFixture: { messages: many }, ...hist3 });
  const left = await runGithubActionsIngestCycle({ d1PersistPath: p11, mockFixture: { messages: many }, ...hist3 });
  results.push({ id: "int_batch_continuation", pass: left.fetchResult?.batchSize === 3 });

  const p12 = d1Path("12");
  await runGithubActionsIngestCycle({ d1PersistPath: p12, mockFixture: { messages: [{ ...msg, uid: 40 }] } });
  const persisted12 = JSON.parse(fs.readFileSync(p12, "utf8"));
  persisted12.run_leases = {};
  fs.writeFileSync(p12, JSON.stringify(persisted12));
  const store12 = createCjEmailD1Store({ persistPath: p12 });
  store12.acquireRunLease("int-uv12");
  const cp12 = store12.getSyncCheckpoint();
  const prevUv12 = cp12.uidvalidity != null ? Number(cp12.uidvalidity) : null;
  const nextUv12 = (prevUv12 ?? 8001) + 1000;
  const uvReset = store12.applyUidValidityChange(nextUv12, prevUv12, {
    runId: "int-uv12",
    expectedPreviousUidvalidity: prevUv12,
  });
  results.push({
    id: "int_uidvalidity",
    pass: uvReset?.ok === true && uvReset?.reset === true && store12.getSyncCheckpoint().completedUids.length === 0,
  });

  results.push({
    id: "int_bad_imap_creds",
    pass: resolveIngestRuntimeConfig({ IU_CJ_EMAIL_INGEST_OFFLINE: "0", IU_FORPSI_IMAP_CONNECT_APPROVED: "0" }).liveImapAllowed === false,
  });

  results.push({
    id: "int_bad_cj_token",
    pass: probeCjPatFormat({}).state === "NOT_CONFIGURED" && mockInvalidCjTokenResponse().httpStatus === 401,
  });

  const cfgD1 = resolveD1WorkerConfig({ IU_CJ_D1_BACKEND: "worker", IU_CJ_D1_WORKER_ENABLED: "0" });
  const rpc = await invokeD1WorkerRpc(cfgD1, "acquireRunLease", { runId: "x" });
  results.push({ id: "int_cf_d1_blocked", pass: rpc.blocked === true });

  results.push({
    id: "int_ai_quota",
    pass: classifyAffiliateEmailWithAi("Kupón X", { quota: { maxCallsPerDay: 0, callsUsed: 0 } }).state === "quota_exceeded",
  });

  const multi = await runGithubActionsIngestCycle({
    d1PersistPath: d1Path("13"),
    mockFixture: { messages: [{ uid: 50, uidvalidity: 8001, bodyText: FIXTURE_VIVANTIS_MULTI.bodyText, subject: "multi" }] },
  });
  results.push({ id: "int_multi_offer", pass: multi.pipelineResults?.[0]?.lifecycle?.ok === true });

  const ban = processMessageThroughFullPipeline({ uid: 6, uidvalidity: 1, ...FIXTURE_SEPHORA_RHODE_BAN }, {});
  results.push({ id: "int_v15_ban", pass: ban.v15?.stagingPublishable === false && ban.publishable === false });

  const body = "Kupón REALONLY";
  const fake = processMessageThroughFullPipeline(
    { uid: 1, bodyText: body },
    { forceAi: true, simulateAiPayload: buildHallucinatedAiPayload() }
  );
  results.push({ id: "int_ai_fake_coupon", pass: fake.publishable === false && fake.ai?.ok === false });

  results.push({
    id: "int_d1_unauthorized",
    pass: verifyWorkerRequestSignature({ Authorization: "Bearer wrong" }, "{}", "expected-secret-token-32chars-minimum").ok === false,
  });

  results.push({
    id: "int_live_without_approval",
    pass:
      resolveIngestRuntimeConfig({ IU_CJ_EMAIL_INGEST_OFFLINE: "0" }).liveImapAllowed === false &&
      resolveIngestRuntimeConfig({ IU_CJ_D1_BACKEND: "worker", IU_CJ_D1_WORKER_ENABLED: "1" }).d1Backend === "worker",
  });

  const secret = "SUPERSECRET_PAT_abcdefghijklmnopqrstuvwxyz";
  const logged = JSON.stringify({ probe: probeCjPatFormat({ IU_CJ_PAT: secret }) });
  results.push({ id: "int_no_token_in_logs", pass: !logged.includes(secret) });

  const badMime = parseRawMimeMessage("Content-Type: multipart/mixed\r\n\r\nno boundary here");
  results.push({ id: "int_bad_mime", pass: badMime.ok === false && Boolean(badMime.rejectReason) });

  const badLink = processMessageThroughFullPipeline({
    uid: 1,
    bodyText: "Visit http://evil.example/phish\nCID: 999",
    from: "spam@evil.example",
  });
  results.push({ id: "int_bad_partner_link", pass: badLink.publishable === false });

  const p14 = d1Path("14");
  const srvState = p14 + ".server.json";
  const srv = await import("./iu-cj-affiliate-phase2-cj-email-d1-worker-local-server.mjs").then((m) =>
    m.startD1WorkerLocalServer({ persistPath: srvState, token: "test-ingest-token-32chars-minimum-length" })
  );
  const envWorker = {
    IU_CJ_D1_BACKEND: "worker",
    IU_CJ_D1_WORKER_HTTP_INTEGRATION_TEST: "1",
    IU_CJ_D1_WORKER_URL: srv.baseUrl,
    IU_CJ_D1_WORKER_INGEST_TOKEN: "test-ingest-token-32chars-minimum-length",
  };
  const store14 = createCjEmailD1Store({ env: envWorker });
  const wRun = await runGithubActionsIngestCycle({ mockFixture: { messages: [{ ...msg, uid: 60 }] }, env: envWorker });
  await srv.close();
  await new Promise((r) => setTimeout(r, 150));
  results.push({ id: "int_d1_worker_http", pass: store14.backend === "worker-http-test" && wRun.ok });

  const aiBlocked = classifyAffiliateEmailWithAi("test", {
    env: { IU_CJ_WORKERS_AI_ENABLED: "1", IU_CJ_WORKERS_AI_HTTP_EXECUTE: "1", IU_CJ_EMAIL_INGEST_OFFLINE: "0" },
  });
  results.push({ id: "int_workers_ai_blocked", pass: aiBlocked.blocked === true && aiBlocked.reason === "workers_ai_use_async_http_classify" });

  results.push({
    id: "int_signing_off",
    pass: PRODUCTION_SIGNING_ENABLED === false && resolveCjApiConfig({}).enabled === false,
  });

  const failed = results.filter((r) => !r.pass).length;
  console.log(
    JSON.stringify({
      IU_CJ_GITHUB_ACTIONS_INGEST_INTEGRATION_V6: failed === 0 ? "OK" : "FAIL",
      passed: results.length - failed,
      failed,
      results,
    })
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(JSON.stringify({ IU_CJ_GITHUB_ACTIONS_INGEST_INTEGRATION_V6: "FAIL", error: String(e.message || e) }));
  process.exit(1);
});
