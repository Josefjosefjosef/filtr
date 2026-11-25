/**
 * V51.8 — email robot end-to-end readiness AUDIT (read-only).
 *
 * - Reads repo files only (fs.readFileSync / existsSync). Never connects to IMAP,
 *   never writes into the repo, never arms publication.
 * - Publication of email-only offers is reported as DISARMED (hard constant).
 * - Summarises: module presence, secret-name mapping drift
 *   (IU_FORPSI_IMAP_* in code/workflow vs IU_CJ_EMAIL_IMAP_* in owner setup guide),
 *   supported vs unsupported event/offer types.
 *
 * Existing selftests / modules this audit relies on (documented paths):
 *   scripts/iu-cj-affiliate-phase3z-email-technical-readiness-v51-8(.mjs|-selftest.mjs)
 *   scripts/iu-cj-affiliate-phase3z-email-owner-setup-v51-8.mjs
 *   scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1(.mjs|-selftest.mjs)
 *   scripts/iu-cj-affiliate-phase3r-ai-email-event-v1(.mjs|-selftest.mjs)
 *   scripts/iu-cj-affiliate-phase3r-email-content-state-v1(.mjs|-selftest.mjs)
 *   scripts/iu-forpsi-imap-credentials-interface.mjs
 *   .github/workflows/cj-affiliate-email-ingest.yml
 *
 * CLI: node scripts/iu-cj-affiliate-phase3z-email-e2e-readiness-audit-v51-8.mjs [outPath]
 *   outPath given -> JSON written there (use %TEMP%); otherwise stdout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EMAIL_E2E_READINESS_AUDIT_SCHEMA =
  "iu-cj-affiliate-phase3z-email-e2e-readiness-audit-v51-8";

const SELFTESTS = [
  "scripts/iu-cj-affiliate-phase3z-email-technical-readiness-v51-8-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3r-ai-email-event-v1-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3r-email-content-state-v1-selftest.mjs",
  "scripts/iu-cj-affiliate-phase3z-email-hints-bridge-v19-selftest.mjs",
];

const MODULES = [
  "scripts/iu-cj-affiliate-phase2-email-ingest-lib.mjs",
  "scripts/iu-cj-affiliate-phase2-email-ingest-imap-pipeline-seal.mjs",
  "scripts/iu-cj-affiliate-phase2-forpsi-imap-poll-lib.mjs",
  "scripts/iu-forpsi-imap-credentials-interface.mjs",
  "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs",
  "scripts/iu-cj-affiliate-phase3r-email-content-state-v1.mjs",
  "scripts/iu-cj-affiliate-phase3r-ai-email-event-v1.mjs",
  "scripts/iu-cj-affiliate-phase3z-email-hints-bridge-v19.mjs",
  "scripts/iu-cj-affiliate-phase3z-email-technical-readiness-v51-8.mjs",
  "scripts/iu-cj-affiliate-phase3z-email-owner-setup-v51-8.mjs",
  "cloudflare/cj-email-ingest-d1-worker/src/index.js",
  ".github/workflows/cj-affiliate-email-ingest.yml",
];

/** Fallback copies (used only if the AI event module cannot be imported). */
const FALLBACK_SUPPORTED = [
  "COUPON_NEW",
  "COUPON_EXPIRED",
  "PROMO_NEW",
  "PRODUCT_NEW",
  "OFFER_CHANGED",
];
const FALLBACK_ALL_EVENT_TYPES = [
  "PARTNER_APPROVED",
  "PARTNER_ENDED",
  "TERMS_CHANGED",
  "COUPON_NEW",
  "COUPON_EXPIRED",
  "PROMO_NEW",
  "PRODUCT_NEW",
  "OFFER_CHANGED",
  "INFORMATIONAL",
  "UNTRUSTED_OR_UNCLEAR",
];

function readText(repoRoot, rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
}

function exists(repoRoot, rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function uniqueMatches(text, re) {
  if (!text) return [];
  return [...new Set(text.match(re) || [])].sort();
}

function loadEventTypes(repoRoot) {
  // Static parse (sync, no module side effects / heavy imports).
  const rel = "scripts/iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
  const src = readText(repoRoot, rel);
  if (src) {
    const block = src.match(/AI_EVENT_TYPE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
    const names = uniqueMatches(block ? block[1] : "", /[A-Z][A-Z_]+(?=\s*:)/g);
    if (names.length > 0) return { all: names, source: "static-parse:" + rel };
  }
  return { all: [...FALLBACK_ALL_EVENT_TYPES].sort(), source: "fallback-constant" };
}

function parseSupportedFromReconcile(repoRoot, allTypes) {
  const rel = "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs";
  const src = readText(repoRoot, rel);
  if (!src) return { supported: [...FALLBACK_SUPPORTED], source: "fallback-constant" };
  const found = uniqueMatches(src, /AI_EVENT_TYPE\.([A-Z_]+)/g)
    .map((s) => s.replace("AI_EVENT_TYPE.", ""))
    .filter((n) => allTypes.includes(n));
  // Only types that participate in the isOffer predicate count as supported.
  const isOfferBlock = src.match(/const isOffer =([\s\S]*?);/);
  const offerTypes = isOfferBlock
    ? uniqueMatches(isOfferBlock[1], /AI_EVENT_TYPE\.([A-Z_]+)/g).map((s) =>
        s.replace("AI_EVENT_TYPE.", ""),
      )
    : found;
  if (offerTypes.length === 0) {
    return { supported: [...FALLBACK_SUPPORTED], source: "fallback-constant" };
  }
  return { supported: offerTypes, source: "static-parse:" + rel };
}

function buildSecretMapping(repoRoot) {
  const workflowRel = ".github/workflows/cj-affiliate-email-ingest.yml";
  const credRel = "scripts/iu-forpsi-imap-credentials-interface.mjs";
  const ownerRel = "scripts/iu-cj-affiliate-phase3z-email-owner-setup-v51-8.mjs";

  const wf = readText(repoRoot, workflowRel);
  const cred = readText(repoRoot, credRel);
  const owner = readText(repoRoot, ownerRel);

  const re = /IU_FORPSI_IMAP_[A-Z_]+/g;
  const reCj = /IU_CJ_EMAIL_IMAP_[A-Z_]+/g;

  const runtimeForpsi = uniqueMatches(cred, re);
  const workflowForpsi = uniqueMatches(wf, re);
  const ownerCj = uniqueMatches(owner, reCj);
  const workflowCj = uniqueMatches(wf, reCj);
  const runtimeCj = uniqueMatches(cred, reCj);

  const runtimeSecretNames = ["IU_FORPSI_IMAP_USER", "IU_FORPSI_IMAP_SECRET"];
  const ownerGuideNames = ownerCj;

  // Documented equivalence the owner has to apply by hand (not auto-detected in code).
  const suggestedMapping = [
    { ownerGuideName: "IU_CJ_EMAIL_IMAP_USER", runtimeName: "IU_FORPSI_IMAP_USER" },
    { ownerGuideName: "IU_CJ_EMAIL_IMAP_PASS", runtimeName: "IU_FORPSI_IMAP_SECRET" },
    {
      ownerGuideName: "IU_CJ_EMAIL_IMAP_HOST",
      runtimeName: null,
      note: "No IU_FORPSI_IMAP_HOST consumed by credentials interface; host is not a secret there.",
    },
  ];

  const drift =
    ownerGuideNames.length > 0 &&
    workflowCj.length === 0 &&
    runtimeCj.length === 0 &&
    workflowForpsi.length > 0;

  return {
    drift,
    severity: drift ? "HIGH_OWNER_MISCONFIG_RISK" : "NONE_DETECTED",
    runtimeSecretNames,
    runtimeEnvNamesInCode: runtimeForpsi,
    workflowEnvNames: workflowForpsi,
    ownerGuideNames,
    workflowReferencesOwnerGuideNames: workflowCj,
    runtimeReferencesOwnerGuideNames: runtimeCj,
    connectApprovalVar: "IU_FORPSI_IMAP_CONNECT_APPROVED",
    sources: { workflow: workflowRel, credentials: credRel, ownerGuide: ownerRel },
    suggestedMapping,
    ownerAction: drift
      ? "Create secrets IU_FORPSI_IMAP_USER / IU_FORPSI_IMAP_SECRET (what workflow+code read) and set variable IU_FORPSI_IMAP_CONNECT_APPROVED=1 only after approval; OR update owner guide/workflow so both use one prefix. Secrets named IU_CJ_EMAIL_IMAP_* are currently NOT read by the ingest workflow."
      : "none",
  };
}

/**
 * Build the read-only readiness audit object.
 * @param {{repoRoot?: string, now?: Date}} [opts]
 */
export function buildEmailE2EReadinessAudit(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const now = opts.now instanceof Date ? opts.now : new Date();

  const modules = MODULES.map((rel) => ({ path: rel, present: exists(repoRoot, rel) }));
  const selftests = SELFTESTS.map((rel) => ({ path: rel, present: exists(repoRoot, rel) }));
  const missingModules = modules.filter((m) => !m.present).map((m) => m.path);

  const { all: allEventTypes, source: eventTypesSource } = loadEventTypes(repoRoot);
  const { supported, source: supportedSource } = parseSupportedFromReconcile(
    repoRoot,
    allEventTypes,
  );
  const unsupported = allEventTypes.filter((t) => !supported.includes(t));

  const reconcileSrc = readText(repoRoot, "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs") || "";
  const safety = {
    emailOfferStagingArmedGate: /emailOfferStagingArmed/.test(reconcileSrc),
    emailNeverChangesJoinedEnded: /Email never changes JOINED\/ENDED/.test(reconcileSrc),
    requiresAuthorizedCjUrl: /authorized CJ/.test(reconcileSrc),
    armedDefaultFalse: /opts\.emailOfferStagingArmed\s*===\s*true/.test(reconcileSrc),
  };

  const secretMapping = buildSecretMapping(repoRoot);

  const wf = readText(repoRoot, ".github/workflows/cj-affiliate-email-ingest.yml") || "";
  const liveConnectGate = /IU_FORPSI_IMAP_CONNECT_APPROVED/.test(wf);

  const blockers = [];
  if (missingModules.length) blockers.push("missing_modules:" + missingModules.join(","));
  if (secretMapping.drift) blockers.push("secret_name_drift_IU_FORPSI_vs_IU_CJ_EMAIL");
  if (!safety.armedDefaultFalse) blockers.push("reconcile_armed_default_not_verified");
  if (!liveConnectGate) blockers.push("workflow_live_connect_gate_not_found");

  return {
    schema: EMAIL_E2E_READINESS_AUDIT_SCHEMA,
    at: now.toISOString(),
    readOnly: true,
    publishingDisarmed: true,
    publicationDefault: "DISARMED",
    emailOfferStagingArmed: false,
    growthArmed: false,
    modules,
    missingModules,
    selftests,
    safety,
    liveConnectGate: {
      variable: "IU_FORPSI_IMAP_CONNECT_APPROVED",
      presentInWorkflow: liveConnectGate,
    },
    secretNameMapping: secretMapping,
    eventTypesSource,
    supportedOfferTypesSource: supportedSource,
    supportedOfferTypes: supported,
    unsupportedOfferTypes: unsupported,
    unsupportedNote:
      "Unsupported types are skipped by reconcile (not_offer_event): lifecycle/informational events never publish an offer and never change JOINED/ENDED.",
    blockers,
    verdict:
      blockers.length === 0
        ? "E2E_CODE_READY_PUBLICATION_DISARMED"
        : "E2E_NOT_READY_PUBLICATION_DISARMED",
    note: "Read-only audit. Does not arm growth or email publication, does not touch IMAP, does not write to the repo.",
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const audit = buildEmailE2EReadinessAudit({ repoRoot: process.cwd() });
  const json = JSON.stringify(audit, null, 2);
  const outPath = process.argv[2];
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, json + "\n", "utf8");
    console.log(JSON.stringify({ written: path.resolve(outPath), verdict: audit.verdict }));
  } else {
    console.log(json);
  }
}
