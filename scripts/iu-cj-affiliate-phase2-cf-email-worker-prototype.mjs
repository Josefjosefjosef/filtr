/**
 * Offline prototype: Email Worker / FORPSI IMAP / fixture → shared pipeline.
 * No Cloudflare tokens, no production D1, no auto-publication.
 */
import { parseRawMimeMessage } from "./iu-cj-affiliate-phase2-forpsi-mime-lib.mjs";
import { normalizeFetchedMessage } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import { processPartnerMessageForForpsiStaging } from "./iu-cj-affiliate-phase2-forpsi-imap-ingest-lib.mjs";
import { extractStructuredOffersFromMessage } from "./iu-cj-affiliate-phase2-affiliate-offer-classifier.mjs";
import { buildOfflineTestMailboxMessageKey, PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { validateAiOfferJson } from "./iu-cj-affiliate-phase2-ai-offer-evidence-validator.mjs";
import { classifyAffiliateEmailWithAi } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";

export { validateAiOfferJson };

export const INGEST_SOURCE = Object.freeze({
  cloudflare_email_worker: "cloudflare_email_worker",
  forpsi_imap: "forpsi_imap",
  offline_fixture: "offline_fixture",
});

export const AI_PROCESSING_STATE = Object.freeze({
  skipped_deterministic: "skipped_deterministic",
  mock_ai_ok: "mock_ai_ok",
  needs_review: "needs_review",
  quota_exceeded: "quota_exceeded",
  ai_failed: "ai_failed",
  invalid_ai_json: "invalid_ai_json",
});

const DEFAULT_AI_QUOTA = Object.freeze({
  maxCallsPerDay: 50,
  maxInputChars: 12_000,
  callsUsed: 0,
});

const OFFER_AI_SCHEMA = Object.freeze({
  type: "object",
  required: ["offers"],
  properties: {
    offers: {
      type: "array",
      items: {
        type: "object",
        required: ["evidenceSpan", "confidence"],
        properties: {
          evidenceSpan: { type: "string" },
          couponCode: { type: ["string", "null"] },
          discountPercent: { type: ["number", "null"] },
          advertiserHint: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
});

export function sanitizeTextForAi(bodyText, limits = {}) {
  const max = limits.maxInputChars ?? DEFAULT_AI_QUOTA.maxInputChars;
  return String(bodyText || "")
    .replace(/\0/g, "")
    .slice(0, max);
}

export function mockWorkersAiClassify(bodyText, options = {}) {
  const quota = { ...DEFAULT_AI_QUOTA, ...(options.quota || {}) };
  if (quota.callsUsed >= quota.maxCallsPerDay) {
    return { ok: false, state: AI_PROCESSING_STATE.quota_exceeded, payload: null };
  }
  if (options.simulateFailure) {
    return { ok: false, state: AI_PROCESSING_STATE.ai_failed, payload: null };
  }
  if (options.simulateBadJson) {
    return { ok: false, state: AI_PROCESSING_STATE.invalid_ai_json, payload: { offers: [{ confidence: "high" }] } };
  }
  const text = String(bodyText || "");
  const offers = [];
  const couponMatch = text.match(/\b([A-Z0-9]{4,20})\b/g);
  if (couponMatch) {
    for (const code of couponMatch.slice(0, 5)) {
      if (/^(CID|LINK|HTTP)$/i.test(code)) continue;
      offers.push({
        evidenceSpan: code,
        couponCode: code,
        discountPercent: null,
        advertiserHint: null,
        confidence: "medium",
      });
    }
  }
  quota.callsUsed += 1;
  return {
    ok: true,
    state: offers.length ? AI_PROCESSING_STATE.mock_ai_ok : AI_PROCESSING_STATE.needs_review,
    payload: { offers },
    quotaAfter: { ...quota },
  };
}

export function ingestFromRawMime(rawMime, meta = {}) {
  const parsed = parseRawMimeMessage(rawMime);
  const normalized = normalizeFetchedMessage({
    uid: meta.uid ?? 1,
    uidvalidity: meta.uidvalidity ?? 1,
    mailbox: meta.mailbox,
    folder: meta.folder || "INBOX",
    rawRfc822: rawMime,
  });
  return { parsed, normalized, source: meta.source || INGEST_SOURCE.offline_fixture };
}

/**
 * Hybrid pipeline: deterministic classifier first; AI only when requested and within quota.
 */
export function runHybridAffiliateEmailPipeline(input, context = {}) {
  const source = input.source || INGEST_SOURCE.offline_fixture;
  let message = input.message;
  if (input.rawMime && !message) {
    const ing = ingestFromRawMime(input.rawMime, input);
    if (ing.parsed.ok === false) {
      return {
        ok: false,
        source,
        stage: "mime_parse",
        rejectReason: ing.parsed.rejectReason,
        publishable: false,
        productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
        publicationGateV15: "blocked_mime_reject",
      };
    }
    message = ing.normalized;
  }
  if (!message) {
    return { ok: false, source, stage: "missing_message", publishable: false };
  }

  const staging = processPartnerMessageForForpsiStaging(message, context);
  const mbKey = buildOfflineTestMailboxMessageKey({
    uid: message.uid,
    uidvalidity: message.uidvalidity,
    mailbox: message.mailbox,
    folder: message.folder,
  });
  const deterministic = extractStructuredOffersFromMessage(message, mbKey);

  let aiResult = { ok: true, state: AI_PROCESSING_STATE.skipped_deterministic, payload: null };
  const needsAi =
    context.forceAi === true ||
    (deterministic.offers.length === 0 && staging.affiliateCategories?.includes("requires_review"));
  if (needsAi) {
    const safeText = sanitizeTextForAi(message.bodyText || message.bodyHtmlStripped || "");
    aiResult = classifyAffiliateEmailWithAi(safeText, context);
    if (aiResult.state === AI_PROCESSING_STATE.quota_exceeded || aiResult.state === AI_PROCESSING_STATE.ai_failed) {
      return {
        ok: true,
        source,
        stage: "queued",
        processingState: "needs_review",
        ai: aiResult,
        staging,
        deterministic,
        publishable: false,
        autoAllowed: false,
        publicationGateV15: "unchanged_not_evaluated_in_staging",
        productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
        queueHint: "persist_job_retry_when_quota_available",
      };
    }
    if (aiResult.payload) {
      const v = validateAiOfferJson(aiResult.payload, safeText);
      if (!v.ok) {
        aiResult = { ok: false, state: AI_PROCESSING_STATE.invalid_ai_json, payload: aiResult.payload, reason: v.reason };
      }
    }
  }

  const publishable = false;
  return {
    ok: staging.state !== "error",
    source,
    stage: "staging_record",
    processingState: staging.state,
    ai: aiResult,
    staging,
    deterministic,
    publishable,
    autoAllowed: false,
    publicationGateV15: staging.publicationGateV15 || "unchanged_not_evaluated_in_staging",
    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
    contractGateNote: "v15 grantsFromDocumentEvidence not invoked in staging prototype",
    schema: OFFER_AI_SCHEMA,
  };
}

export function describeIngestAdapterSwitch() {
  return {
    sharedCore: [
      "parseRawMimeMessage",
      "normalizeFetchedMessage",
      "processPartnerMessageForForpsiStaging",
      "extractStructuredOffersFromMessage",
      "runHybridAffiliateEmailPipeline",
    ],
    adapters: Object.values(INGEST_SOURCE),
    productionBlocked: true,
  };
}
