import {
  runHybridAffiliateEmailPipeline,
  sanitizeTextForAi,
  AI_PROCESSING_STATE,
  INGEST_SOURCE,
} from "./iu-cj-affiliate-phase2-cf-email-worker-prototype.mjs";
import { classifyAffiliateEmailWithAi } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";
import { validateAiOfferJson } from "./iu-cj-affiliate-phase2-ai-offer-evidence-validator.mjs";
import { assessEmailStagingPublicationV15 } from "./iu-cj-affiliate-phase2-v15-email-staging-gate.mjs";

export function processMessageThroughFullPipeline(message, context = {}) {
  const bodyForAi = message.bodyText || message.bodyHtmlStripped || "";
  const pipeCtx = { ...(context.pipelineContext || {}) };
  if (context.forceAi != null) pipeCtx.forceAi = context.forceAi;
  if (context.quota != null) pipeCtx.quota = context.quota;
  const hybrid = runHybridAffiliateEmailPipeline(
    { source: context.source || INGEST_SOURCE.forpsi_imap, message },
    pipeCtx
  );
  if (context.simulateAiPayload) {
    const aiValidated = validateAiOfferJson(context.simulateAiPayload, bodyForAi);
    hybrid.ai = {
      ok: aiValidated.ok,
      state: aiValidated.ok ? AI_PROCESSING_STATE.mock_ai_ok : AI_PROCESSING_STATE.invalid_ai_json,
      payload: context.simulateAiPayload,
      reason: aiValidated.reason,
    };
  } else if (context.forceAi) {
    const safeText = sanitizeTextForAi(bodyForAi);
    let ai = classifyAffiliateEmailWithAi(safeText, context);
    if (ai.payload) {
      const aiValidated = validateAiOfferJson(ai.payload, bodyForAi);
      if (!aiValidated.ok) {
        ai = { ...ai, ok: false, state: AI_PROCESSING_STATE.invalid_ai_json, reason: aiValidated.reason };
      }
    }
    hybrid.ai = ai;
  }
  const v15 = assessEmailStagingPublicationV15(message, hybrid.staging || {}, context.v15Options || {});
  hybrid.v15 = v15;
  hybrid.publishable = false;
  hybrid.autoAllowed = false;
  return hybrid;
}
