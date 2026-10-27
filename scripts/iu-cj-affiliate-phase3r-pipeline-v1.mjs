#!/usr/bin/env node
/**
 * Phase 3R pipeline: Forpsi IMAP drain → AI events → CJ reconcile hints (DISARMED).
 *
 * Never prints secrets / full email bodies.
 * Never arms public LIVE publishing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORPSI_IMAP_SYNC_DEFAULTS } from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import { runForpsiLiveImapPoll } from "./iu-cj-affiliate-phase3q-forpsi-live-imap-poll-v1.mjs";
import {
  classifyEmailRowToEvents,
  aiEventsToCjHints,
  describeWorkersAiCostModel,
  AI_EVENT_TYPE,
} from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
import { reconcileAiEventBatch } from "./iu-cj-affiliate-phase3r-ai-to-cj-reconcile-v1.mjs";

export const PHASE3R_PIPELINE_SCHEMA = "iu-cj-affiliate-phase3r-pipeline-v1";

function redactSecrets(s) {
  let out = String(s || "");
  for (const key of ["IU_FORPSI_IMAP_SECRET", "IU_FORPSI_IMAP_USER", "CLOUDFLARE_API_TOKEN", "IU_CJ_PAT"]) {
    const v = String(process.env[key] || "").trim();
    if (v) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

function stripBodiesFromPoll(poll) {
  if (!poll || typeof poll !== "object") return poll;
  const clone = { ...poll };
  if (Array.isArray(clone.hints)) {
    clone.hints = clone.hints.map((h) => ({
      uid: h.uid,
      categories: h.categories,
      lifecycleAction: h.lifecycleAction,
      mutate: false,
      requiresCjApi: true,
      eventType: h.eventType || null,
      confidence: h.confidence || null,
      advertiserId: h.advertiserId || null,
    }));
  }
  delete clone.batchResults;
  delete clone._batchResultsForAi;
  return clone;
}

export async function runPhase3rPipeline(options = {}) {
  const startedAt = new Date().toISOString();
  const maxBatches = Number(
    options.maxBatchesPerRun ||
      process.env.IU_FORPSI_IMAP_MAX_BATCHES_PER_RUN ||
      FORPSI_IMAP_SYNC_DEFAULTS.maxBatchesPerRun ||
      4
  );
  const batchSize = Number(
    options.batchSize || process.env.IU_FORPSI_IMAP_BATCH_SIZE || FORPSI_IMAP_SYNC_DEFAULTS.batchSize
  );
  const useMockAi = options.useMockAi === true || process.env.IU_CJ_WORKERS_AI_FORCE_MOCK === "1";
  const forceMockImap = options.forceMockImap === true || process.env.IU_FORPSI_IMAP_FORCE_MOCK === "1";

  const batches = [];
  const allRows = [];
  let lastPoll = null;
  let messagesChecked = 0;
  let messagesRead = 0;
  let duplicates = 0;
  let quarantined = 0;
  let errors = 0;

  for (let i = 0; i < maxBatches; i++) {
    const poll = await runForpsiLiveImapPoll({
      forceMock: forceMockImap,
      mockFixture: options.mockFixture,
      checkpointDir: options.checkpointDir,
      batchSize,
      ownerId: options.ownerId || "phase3r-" + (process.env.GITHUB_RUN_ID || process.pid) + "-b" + i,
      catalogAdvertisers: options.catalogAdvertisers || [],
    });
    lastPoll = poll;
    if (!poll.ok) {
      return {
        schema: PHASE3R_PIPELINE_SCHEMA,
        ok: false,
        status: poll.status || "POLL_FAILED",
        imapConnected: poll.imapConnected === true,
        authSuccess: poll.authSuccess === true,
        reason: redactSecrets(poll.reason || "poll_failed"),
        liveEnabled: false,
        publishArmed: false,
        cjLivePublishing: "DISARMED",
        exitCode: poll.exitCode || 1,
        batchesAttempted: i + 1,
        ai: { aiActuallyRan: false },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
    messagesChecked = poll.messagesChecked ?? messagesChecked;
    messagesRead += poll.messagesInBatch ?? 0;
    duplicates += poll.duplicates ?? 0;
    quarantined += poll.quarantined ?? 0;
    errors += poll.errors ?? 0;

    // Re-run sync internals already consumed UIDs; collect AI-safe rows from hints rebuild path.
    // Poll result does not expose batchResults — recover via checkpoint side-channel if provided.
    const rows = Array.isArray(poll._batchResultsForAi)
      ? poll._batchResultsForAi
      : Array.isArray(options.injectBatchRows)
        ? options.injectBatchRows
        : [];
    for (const r of rows) allRows.push(r);
    batches.push({
      index: i,
      messagesInBatch: poll.messagesInBatch ?? 0,
      pendingAfterBatch: poll.checkpoint?.pendingAfterBatch ?? null,
      complete: poll.checkpoint?.complete === true,
      uidvalidity: poll.checkpoint?.uidvalidity ?? null,
    });
    if (poll.checkpoint?.complete === true) break;
    if ((poll.messagesInBatch ?? 0) === 0) break;
  }

  // Prefer rows collected; if empty, synthesize from last poll hints (categories only → deterministic).
  let classifyRows = allRows;
  if (!classifyRows.length && lastPoll?.hints?.length) {
    classifyRows = lastPoll.hints.map((h) => ({
      uid: h.uid,
      categories: h.categories || [],
      subjectSafe: "uid:" + h.uid,
      fromSafe: "owner-membermessaging@mx6.cj.com",
      excerptSafe: (h.categories || []).join(", "),
    }));
  }

  const quota = { callsUsed: 0 };
  const classified = [];
  let aiActuallyRan = false;
  let aiBackend = "none";
  let aiModel = null;
  const allEvents = [];

  for (const row of classifyRows) {
    const cls = await classifyEmailRowToEvents(row, {
      useMock: useMockAi,
      env: options.env || process.env,
      quota,
    });
    if (cls.aiActuallyRan) aiActuallyRan = true;
    if (cls.backend === "workers-ai" || cls.backend === "mock") {
      aiBackend = cls.backend;
    } else if (aiBackend === "none" && cls.backend) {
      aiBackend = cls.backend;
    }
    if (cls.model) aiModel = cls.model;
    if (cls?.quotaAfter?.callsUsed != null) quota.callsUsed = cls.quotaAfter.callsUsed;
    const events = cls.events || [];
    for (const ev of events) allEvents.push({ ...ev, uid: row.uid });
    const hints = aiEventsToCjHints(events, {
      uid: row.uid,
      from: row.fromSafe,
      subject: row.subjectSafe,
      fromTrusted: /cj\.com/i.test(String(row.fromSafe || "")) || options.trustFrom !== false,
    });
    classified.push({
      uid: row.uid,
      backend: cls.backend,
      aiActuallyRan: cls.aiActuallyRan === true,
      eventTypes: events.map((e) => e.eventType),
      hintsCount: hints.length,
    });
  }

  const reconcile = await reconcileAiEventBatch(allEvents, {
    useMock: options.useMockCj !== false && process.env.IU_CJ_CJ_API_HTTP_EXECUTE !== "1",
    env: options.env || process.env,
    applyStagingEnded: options.applyStagingEnded === true,
    stagingCatalog: options.stagingCatalog || [],
    forceConfirmedEnded: options.forceConfirmedEnded === true,
    slotByAdvertiserId: options.slotByAdvertiserId || {},
  });

  const relevantHints = allEvents.filter(
    (e) => e.eventType && e.eventType !== AI_EVENT_TYPE.INFORMATIONAL
  ).length;

  return {
    schema: PHASE3R_PIPELINE_SCHEMA,
    ok: true,
    status: "PHASE3R_PIPELINE_OK",
    imapConnected: lastPoll?.imapConnected === true || forceMockImap,
    authSuccess: lastPoll?.authSuccess === true || forceMockImap,
    mailboxInventory: messagesChecked,
    messagesRead,
    messagesClassified: classified.length,
    relevantHints,
    duplicates,
    quarantined,
    errors,
    batches,
    checkpoint: lastPoll?.checkpoint || null,
    ai: {
      aiActuallyRan,
      backend: aiBackend,
      model: aiModel,
      costModel: describeWorkersAiCostModel(),
      callsUsed: quota.callsUsed,
      classifiedSample: classified.slice(0, 30),
    },
    cjReconcile: {
      passedToRobot: reconcile.counts?.passedToRobot ?? 0,
      verifiedViaCjApi: reconcile.counts?.verifiedViaCjApi ?? 0,
      stagingAddPlans: reconcile.counts?.stagingAddPlans ?? 0,
      stagingUpdatePlans: reconcile.counts?.stagingUpdatePlans ?? 0,
      stagingEndedPlans: reconcile.counts?.stagingEndedPlans ?? 0,
      manualReview: reconcile.counts?.manualReview ?? 0,
      protectedSkip: reconcile.counts?.protectedSkip ?? 0,
    },
    poll: stripBodiesFromPoll(lastPoll),
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    mutatePartners: false,
    authority: "CJ_API_ONLY",
    cjApiFollowUp: "EMAIL_HINT_REQUIRES_CJ_RECONCILE_ONLY",
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: 0,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  runPhase3rPipeline({})
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      process.exit(typeof out.exitCode === "number" ? out.exitCode : out.ok ? 0 : 1);
    })
    .catch((err) => {
      console.log(
        JSON.stringify({
          schema: PHASE3R_PIPELINE_SCHEMA,
          ok: false,
          status: "PIPELINE_EXCEPTION",
          reason: redactSecrets(String(err?.message || err).slice(0, 200)),
          liveEnabled: false,
          publishArmed: false,
          exitCode: 1,
        })
      );
      process.exit(1);
    });
}
