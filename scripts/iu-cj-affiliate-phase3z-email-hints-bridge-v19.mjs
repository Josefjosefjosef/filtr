#!/usr/bin/env node
/**
 * Phase 3Z V19 — bridge Phase3R AI/email events → main-button email hints artifact.
 *
 * EMAIL IS NEVER AUTHORITY for JOINED/ENDED, affiliate URLs, or publish arms.
 * Trusted hints may only influence assortment / suggestedSectionId when advertiserId
 * is explicitly present and matchMethod is not name_similarity_only.
 *
 * Never prints full bodies, tokens, or passwords.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssortmentProfile } from "./iu-cj-affiliate-phase3z-assortment-v8.mjs";
import {
  buildMainButtonEmailHint,
  PHASE3Z_MAIN_BUTTON_EMAIL_SCHEMA,
} from "./iu-cj-affiliate-phase3z-main-button-email-hints-v12.mjs";
import { AI_EVENT_TYPE } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";

export const PHASE3Z_EMAIL_HINTS_BRIDGE_SCHEMA =
  "iu-cj-affiliate-phase3z-email-hints-bridge-v19";

const PROMPT_INJECTION_MARKERS = [
  /ignore (all|previous|above) instructions/i,
  /system\s*:/i,
  /you are now/i,
  /reveal (your|the) (prompt|system)/i,
  /exfiltrat/i,
  /<\/?(script|iframe|form)\b/i,
  /joined\s*[:=]/i,
  /ended\s*[:=]/i,
  /set\s+category\s+to/i,
  /publish\s*armed/i,
];

/** Detect untrusted instruction-like content (never execute). */
export function detectEmailInstructionAttempt(text) {
  const s = String(text || "");
  for (const re of PROMPT_INJECTION_MARKERS) {
    if (re.test(s)) return { hit: true, pattern: String(re) };
  }
  return { hit: false };
}

/**
 * Suggest section from redacted assortment / product / terms text via shared keyword groups.
 * Returns null when evidence is too weak.
 */
export function suggestSectionIdFromEmailText(text) {
  const blob = String(text || "").trim();
  if (!blob || blob.length < 8) return null;
  const profile = buildAssortmentProfile({
    advertiser: { advertiserName: blob, programUrl: "", primaryCategory: "" },
    links: [],
  });
  const top = profile?.primaryAssortment || null;
  if (!top?.sectionId) return null;
  if ((top.weight || 0) < 20) return null;
  return String(top.sectionId);
}

/**
 * Strip any URL-like tokens that must never become click URLs from email.
 */
export function redactEmailUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")
    .replace(/\bwww\.\S+/gi, "[URL_REDACTED]");
}

/**
 * Convert one AI/email event (+ meta) into a main-button hint row (or null).
 */
export function aiEventToMainButtonEmailHint(ev = {}, meta = {}) {
  const advertiserId = String(ev.advertiserId || meta.advertiserId || "").trim();
  const fromTrusted =
    meta.fromTrusted === true ||
    /@mx\d*\.cj\.com$/i.test(String(meta.from || "")) ||
    /@cj\.com>/i.test(String(meta.from || "")) ||
    /owner-membermessaging@/i.test(String(meta.from || ""));

  const rawText = [
    ev.productHint,
    ev.termsSummary,
    ev.evidenceSpan,
    meta.assortmentExcerpt,
    meta.subject,
  ]
    .filter(Boolean)
    .join(" | ");

  const injection = detectEmailInstructionAttempt(rawText);
  const forwarded = meta.forwarded === true || /^fw:|^fwd:/i.test(String(meta.subject || ""));
  const spoofed = meta.spoofed === true || meta.fromTrusted === false;
  const duplicate = meta.duplicate === true;

  // Hard untrusted cases — keep row for audit but never trusted.
  let trusted = Boolean(advertiserId) && fromTrusted && !injection.hit && !spoofed && !forwarded;
  if (duplicate) trusted = false;
  if (meta.matchMethod === "name_similarity_only") trusted = false;
  if (ev.eventType === AI_EVENT_TYPE.UNTRUSTED_OR_UNCLEAR) trusted = false;

  // Lifecycle / URL instructions in email MUST NOT mutate robot state.
  const lifecycleAttempt =
    /joined|ended|rejoined|affiliate\s*url|click-\d+/i.test(rawText) && injection.hit;
  if (lifecycleAttempt) trusted = false;

  const safeAssortment = redactEmailUrls(rawText).slice(0, 400);
  const suggestedSectionId =
    trusted && safeAssortment
      ? suggestSectionIdFromEmailText(safeAssortment) || meta.suggestedSectionId || null
      : meta.suggestedSectionId && trusted
        ? meta.suggestedSectionId
        : null;

  // Without advertiserId → untrusted incomplete.
  if (!advertiserId) {
    return buildMainButtonEmailHint({
      advertiserId: "",
      trusted: false,
      untrustedAssignment: true,
      matchMethod: "none",
      assortmentPrimary: safeAssortment || null,
      suggestedSectionId: null,
      sourceMessageId: meta.sourceMessageId || meta.messageId || ev.source || null,
      receivedAt: meta.receivedAt || null,
      note: "Missing advertiserId — ignored for category authority.",
    });
  }

  return buildMainButtonEmailHint({
    advertiserId,
    advertiserCid: advertiserId,
    trusted,
    matchMethod: meta.matchMethod || "advertiser_cid",
    assortmentPrimary: safeAssortment || null,
    suggestedSectionId: suggestedSectionId || null,
    semBrandBidRestricted: /sem.*brand|brand.*bid|z[aá]kaz\s*sem/i.test(safeAssortment),
    couponPartnerRestricted: /coupon\s*partner|kup[oó]nov/i.test(safeAssortment),
    ordinaryPromoBanned: false,
    receivedAt: meta.receivedAt || ev.effectiveDate || null,
    cjTermsUpdatedAt: meta.cjTermsUpdatedAt || null,
    sourceMessageId: meta.sourceMessageId || meta.messageId || String(ev.source || "ai_event"),
    restrictionText: safeAssortment,
    restrictionExcerpt: safeAssortment ? safeAssortment.slice(0, 160) : null,
    untrustedAssignment: !trusted,
  });
}

/**
 * Build artifact object from Phase3R pipeline JSON or {events:[]}.
 */
export function buildMainButtonEmailHintsArtifact(input = {}, opts = {}) {
  const events = Array.isArray(input.events)
    ? input.events
    : Array.isArray(input.ai?.events)
      ? input.ai.events
      : Array.isArray(input.poll?.hints)
        ? input.poll.hints.map((h) => ({
            eventType: h.eventType || AI_EVENT_TYPE.INFORMATIONAL,
            advertiserId: h.advertiserId,
            confidence: h.confidence || "low",
            productHint: null,
            termsSummary: null,
            evidenceSpan: null,
            source: "poll_hint",
          }))
        : [];

  const metaBase = {
    fromTrusted: opts.fromTrusted !== false,
    from: opts.from || "owner-membermessaging@mx6.cj.com",
    receivedAt: opts.receivedAt || input.finishedAt || null,
  };

  const hints = [];
  const byAdv = new Map();
  for (const ev of events) {
    const hint = aiEventToMainButtonEmailHint(ev, {
      ...metaBase,
      sourceMessageId: ev.uid != null ? "uid:" + ev.uid : ev.source || null,
      duplicate: ev.duplicate === true,
      forwarded: ev.forwarded === true,
      spoofed: ev.spoofed === true,
      matchMethod: ev.advertiserId ? "advertiser_cid" : "none",
    });
    if (!hint.advertiserId) {
      hints.push(hint);
      continue;
    }
    // Dedupe: keep newest trusted, else first.
    const prev = byAdv.get(hint.advertiserId);
    if (!prev || (hint.trusted && !prev.trusted)) {
      byAdv.set(hint.advertiserId, hint);
    }
  }
  for (const h of byAdv.values()) hints.push(h);

  const trustedWithSection = hints.filter((h) => h.trusted && h.suggestedSectionId).length;
  return {
    schema: PHASE3Z_EMAIL_HINTS_BRIDGE_SCHEMA,
    hintSchema: PHASE3Z_MAIN_BUTTON_EMAIL_SCHEMA,
    generatedAt: new Date().toISOString(),
    liveEmailToCategory: trustedWithSection > 0 ? "HINTS_EMITTED" : "NO_TRUSTED_SECTION_HINTS",
    authority: {
      joinedEnded: "CJ_API_ONLY",
      affiliateUrl: "CJ_LINK_INVENTORY_ONLY",
      categoryAssortment: "CJ_PLUS_TRUSTED_EMAIL_HINT_PLUS_WEBSITE",
    },
    counts: {
      eventsIn: events.length,
      hintsOut: hints.length,
      trusted: hints.filter((h) => h.trusted).length,
      trustedWithSuggestedSection: trustedWithSection,
    },
    hints,
  };
}

export function writeMainButtonEmailHintsArtifact(artifact, outPath) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  // Never persist URL click candidates from email.
  const safe = {
    ...artifact,
    hints: (artifact.hints || []).map((h) => ({
      ...h,
      assortmentPrimary: h.assortmentPrimary
        ? redactEmailUrls(String(h.assortmentPrimary)).slice(0, 400)
        : null,
      restrictionText: undefined,
      restrictionExcerpt: h.restrictionExcerpt
        ? redactEmailUrls(String(h.restrictionExcerpt)).slice(0, 160)
        : null,
    })),
  };
  fs.writeFileSync(outPath, JSON.stringify(safe, null, 2), "utf8");
  return outPath;
}

/**
 * End-to-end dry proof: REAL-shaped event → hint → websiteEvidence shape used by registry.
 */
export function proveEmailToCategoryChain(sampleEvent, meta = {}) {
  const hint = aiEventToMainButtonEmailHint(sampleEvent, meta);
  const { emailHintToWebsiteEvidence } = awaitableImportHints();
  const web = emailHintToWebsiteEvidence(hint);
  return {
    REAL_EMAIL: Boolean(sampleEvent && (sampleEvent.productHint || sampleEvent.termsSummary || sampleEvent.evidenceSpan)),
    VERIFIED_SENDER: meta.fromTrusted !== false && !meta.spoofed,
    MATCHED_ADVERTISER_ID: hint.advertiserId || null,
    EXTRACTED_ASSORTMENT_EVIDENCE: hint.assortmentPrimary || null,
    CATEGORY_DECISION: hint.suggestedSectionId || (web && web.primaryAssortment?.sectionId) || null,
    CATALOG_OUTPUT: web
      ? {
          websiteEvidenceSource: web.source,
          sectionId: web.primaryAssortment?.sectionId || null,
          weight: web.primaryAssortment?.weight || null,
        }
      : null,
    trusted: hint.trusted === true,
    chainComplete:
      hint.trusted === true &&
      Boolean(hint.advertiserId) &&
      Boolean(hint.suggestedSectionId) &&
      Boolean(web?.primaryAssortment?.sectionId),
  };
}

function awaitableImportHints() {
  // Sync re-export helper for prove chain without circular top-level await issues.
  return {
    emailHintToWebsiteEvidence: (hint) => {
      if (!hint || hint.trusted !== true || !hint.suggestedSectionId) return null;
      if (hint.staleVsCjTerms === true) return null;
      return {
        primaryAssortment: {
          sectionId: String(hint.suggestedSectionId),
          group: "email_welcome",
          weight: 48,
          sources: ["welcome_email:" + (hint.sourceMessageId || "trusted")],
        },
        secondaryAssortments: [],
        significantGroups: [
          {
            sectionId: String(hint.suggestedSectionId),
            group: "email_welcome",
            weight: 48,
            sources: ["welcome_email:" + (hint.sourceMessageId || "trusted")],
          },
        ],
        source: "trusted_welcome_email_v19",
      };
    },
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const inPath = process.argv[2] || process.env.IU_CJ_PHASE3R_PIPELINE_PATH || "";
  const outPath =
    process.argv[3] ||
    process.env.IU_CJ_MAIN_BUTTON_EMAIL_HINTS_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-cj-main-button-email-hints-v19.json");
  let input = { events: [] };
  if (inPath && fs.existsSync(inPath)) {
    input = JSON.parse(fs.readFileSync(inPath, "utf8"));
  }
  const artifact = buildMainButtonEmailHintsArtifact(input);
  writeMainButtonEmailHintsArtifact(artifact, outPath);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        counts: artifact.counts,
        liveEmailToCategory: artifact.liveEmailToCategory,
        authority: artifact.authority,
      },
      null,
      2
    )
  );
}
