/** Single-message ingest lifecycle — no complete before D1 + pipeline success. */

import { AFFILIATE_MAILBOX_ADDRESS } from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";

import { MESSAGE_STAGE } from "./iu-cj-affiliate-phase2-cj-email-d1-store.mjs";

import { processMessageThroughFullPipeline } from "./iu-cj-affiliate-phase2-github-actions-ingest-pipeline.mjs";

import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

import { AI_PROCESSING_STATE } from "./iu-cj-affiliate-phase2-cf-email-worker-prototype.mjs";

import { storeOp } from "./iu-cj-affiliate-phase2-message-lifecycle-store-op.mjs";



export const LIFECYCLE_HOOK = Object.freeze({

  after_fetch: "after_fetch",

  before_raw_persist: "before_raw_persist",

  after_raw_persist: "after_raw_persist",

  after_classified: "after_classified",

  during_ai: "during_ai",

  before_final_persist: "before_final_persist",

  after_final_persist: "after_final_persist",

});



function shouldFail(hook, opt) {

  if (!opt || typeof opt !== "object") return false;

  if (!Object.hasOwn(opt, "failAfterStage") && !Object.hasOwn(opt, "simulateInterruptAt")) return false;

  const failStage = opt.failAfterStage;

  const simulateAt = opt.simulateInterruptAt;

  return failStage === hook || failStage === simulateAt;

}



function stageTransitionPatch(opts, extra = {}) {
  const patch = Object.assign(Object.create(null), extra);
  if (opts.runId) patch.runId = opts.runId;
  return patch;
}

function mutationPatch(opts, uidvalidity, extra = {}) {
  return stageTransitionPatch(opts, Object.assign({ expectedUidvalidity: uidvalidity }, extra));
}

export function buildRawSnapshot(message) {

  return {

    subject: message.subject || null,

    from: message.from || null,

    bodyTextBytes: Buffer.byteLength(String(message.bodyText || ""), "utf8"),

    bodyHtmlBytes: Buffer.byteLength(String(message.bodyHtmlStripped || message.bodyHtml || ""), "utf8"),

    attachmentNames: message.attachmentNames || [],

    attachmentBytesTotal: message.attachmentBytesTotal || 0,

    sizeBytes: message.sizeBytes || 0,

    uid: message.uid,

    uidvalidity: message.uidvalidity,

  };

}



export async function processMessageLifecycle(message, store, options = {}) {

  const opts =

    options && typeof options === "object" ? Object.assign(Object.create(null), options) : Object.create(null);

  const mailbox = message.mailbox || AFFILIATE_MAILBOX_ADDRESS;

  const uidvalidity = message.uidvalidity;

  const uid = message.uid;

  const contentHash = store.hashMessageContent({

    mailbox,

    uidvalidity,

    uid,

    messageIdHeader: message.messageIdHeader || null,

    contentSha256: message.contentSha256 || null,

  });

  const key = store.msgKey(mailbox, uidvalidity, uid);



  if (await storeOp(store, "isUidCompleted", uid, uidvalidity)) {

    return { ok: true, duplicate: true, key, uid, publishable: false, stage: MESSAGE_STAGE.completed };

  }



  const begun = await storeOp(
    store,
    "beginMessage",
    { mailbox, uidvalidity, uid, contentHash },
    mutationPatch(opts, uidvalidity)
  );

  if (begun?.ok === false) {
    return { ok: false, key, uid, reason: begun.reason, publishable: false, recoverable: true };
  }

  if (begun.duplicate) {

    return { ok: true, duplicate: true, key, uid, publishable: false, stage: MESSAGE_STAGE.completed };

  }



  if (shouldFail(LIFECYCLE_HOOK.after_fetch, opts)) {

    await storeOp(store, "markFailed", key, "interrupted_after_fetch", mutationPatch(opts, uidvalidity));

    return {

      ok: false,

      interrupted: true,

      interruptReason: "after_fetch",

      key,

      uid,

      stage: MESSAGE_STAGE.failed,

      recoverable: true,

      publishable: false,

    };

  }



  if (shouldFail(LIFECYCLE_HOOK.before_raw_persist, opts)) {

    await storeOp(store, "markFailed", key, "interrupted_before_raw_persist", mutationPatch(opts, uidvalidity));

    return { ok: false, interrupted: true, key, uid, stage: MESSAGE_STAGE.failed, recoverable: true, publishable: false };

  }



  const d1Raw = store.writeWithSimulatedFailure(opts.simulateD1FailureOnRaw);

  if (!d1Raw.ok) {

    await storeOp(store, "markFailed", key, d1Raw.reason, mutationPatch(opts, uidvalidity));

    return { ok: false, key, uid, stage: MESSAGE_STAGE.failed, d1Error: d1Raw.reason, recoverable: true, publishable: false };

  }



  await storeOp(store, "persistRawSnapshot", key, buildRawSnapshot(message), mutationPatch(opts, uidvalidity));

  const toRaw = await storeOp(store, "transitionStage", key, MESSAGE_STAGE.raw_persisted, stageTransitionPatch(opts));

  if (!toRaw.ok) {

    await storeOp(store, "markFailed", key, toRaw.reason || "raw_persist_transition_failed", mutationPatch(opts, uidvalidity));

    return { ok: false, key, uid, reason: toRaw.reason, recoverable: true, publishable: false };

  }



  if (shouldFail(LIFECYCLE_HOOK.after_raw_persist, opts)) {

    await storeOp(store, "markFailed", key, "interrupted_after_raw_persist", mutationPatch(opts, uidvalidity));

    return { ok: false, interrupted: true, key, uid, stage: MESSAGE_STAGE.raw_persisted, recoverable: true, publishable: false };

  }



  const pipeline = processMessageThroughFullPipeline(message, opts.pipelineContext || {});



  if (pipeline.stage === "queued") {

    await storeOp(store, "markFailed", key, "ai_quota_or_outage_deferred", mutationPatch(opts, uidvalidity));

    return {

      ok: false,

      key,

      uid,

      pipeline,

      stage: MESSAGE_STAGE.classified,

      recoverable: true,

      publishable: false,

      deferred: true,

    };

  }



  if (shouldFail(LIFECYCLE_HOOK.after_classified, opts)) {

    await storeOp(store, "markFailed", key, "interrupted_after_classified", mutationPatch(opts, uidvalidity));

    return { ok: false, interrupted: true, key, uid, pipeline, stage: MESSAGE_STAGE.classified, recoverable: true, publishable: false };

  }



  const toClassified = await storeOp(store, "transitionStage", key, MESSAGE_STAGE.classified, stageTransitionPatch(opts, {

    stagingState: pipeline.staging?.state || null,

  }));

  if (!toClassified.ok) {

    await storeOp(store, "markFailed", key, toClassified.reason || "classified_transition_failed", mutationPatch(opts, uidvalidity));

    return { ok: false, key, uid, pipeline, reason: toClassified.reason, recoverable: true, publishable: false };

  }



  const aiRan =

    opts.pipelineContext?.forceAi === true ||

    (pipeline.ai?.state && pipeline.ai.state !== AI_PROCESSING_STATE.skipped_deterministic);

  if (aiRan) {

    if (shouldFail(LIFECYCLE_HOOK.during_ai, opts)) {

      await storeOp(store, "markFailed", key, "interrupted_during_ai", mutationPatch(opts, uidvalidity));

      return { ok: false, interrupted: true, key, uid, pipeline, stage: MESSAGE_STAGE.ai_done, recoverable: true, publishable: false };

    }

    await storeOp(store, "transitionStage", key, MESSAGE_STAGE.ai_done, stageTransitionPatch(opts, { aiState: pipeline.ai?.state || null }));

  }



  const toV15 = await storeOp(store, "transitionStage", key, MESSAGE_STAGE.v15_done, stageTransitionPatch(opts, {

    v15Blockers: pipeline.v15?.blockers?.length || 0,

    gateState: pipeline.v15?.gateState || null,

  }));

  if (!toV15.ok) {

    await storeOp(store, "markFailed", key, toV15.reason || "v15_transition_failed", mutationPatch(opts, uidvalidity));

    return { ok: false, key, uid, pipeline, reason: toV15.reason, recoverable: true, publishable: false };

  }



  if (shouldFail(LIFECYCLE_HOOK.before_final_persist, opts)) {

    await storeOp(store, "markFailed", key, "interrupted_before_final_persist", mutationPatch(opts, uidvalidity));

    return { ok: false, interrupted: true, key, uid, pipeline, recoverable: true, publishable: false };

  }



  const d1Final = store.writeWithSimulatedFailure(opts.simulateD1FailureOnFinal);

  if (!d1Final.ok) {

    await storeOp(store, "markFailed", key, d1Final.reason, mutationPatch(opts, uidvalidity));

    return { ok: false, key, uid, pipeline, d1Error: d1Final.reason, recoverable: true, publishable: false };

  }



  await storeOp(store, "persistResults", key, {

    offersCount: pipeline.deterministic?.offers?.length || 0,

    aiState: pipeline.ai?.state || null,

    v15Blockers: pipeline.v15?.blockers?.length ?? 0,

    stagingState: pipeline.staging?.state || pipeline.v15?.gateState || "v15_evaluated",

  }, mutationPatch(opts, uidvalidity));



  if (shouldFail(LIFECYCLE_HOOK.after_final_persist, opts)) {

    await storeOp(store, "markFailed", key, "interrupted_after_final_persist", mutationPatch(opts, uidvalidity));

    return { ok: false, interrupted: true, key, uid, pipeline, recoverable: true, publishable: false };

  }



  const fin = await storeOp(store, "finalizeCompleted", key, {

    contentHash,

    publishable: false,

    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,

    runId: opts.runId || null,

    expectedUidvalidity: uidvalidity,

  });

  if (!fin.ok) {

    return { ok: false, key, uid, reason: fin.reason, publishable: false };

  }



  return {

    ok: true,

    key,

    uid,

    stage: MESSAGE_STAGE.completed,

    pipeline,

    publishable: false,

    autoAllowed: false,

    publicationAttempted: false,

  };

}


