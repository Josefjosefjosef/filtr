/**
 * V51.8 — email-offer technical readiness inventory.
 * Publication remains DISARMED until owner verification + explicit approval.
 */
import fs from "node:fs";
import path from "node:path";

export const EMAIL_TECHNICAL_READINESS_SCHEMA =
  "iu-cj-affiliate-phase3z-email-technical-readiness-v51-8";

const REQUIRED_MODULES = [
  "scripts/iu-cj-affiliate-phase2-email-ingest-lib.mjs",
  "scripts/iu-cj-affiliate-phase2-email-ingest-imap-pipeline-seal.mjs",
  "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs",
  "scripts/iu-cj-affiliate-phase3r-email-content-state-v1.mjs",
  "scripts/iu-cj-affiliate-phase3z-email-hints-bridge-v19.mjs",
  "cloudflare/cj-email-ingest-d1-worker/src/index.js",
  ".github/workflows/cj-affiliate-email-ingest.yml",
];

export function evaluateEmailTechnicalReadiness(repoRoot = process.cwd()) {
  const modules = REQUIRED_MODULES.map((rel) => {
    const abs = path.join(repoRoot, rel);
    return { path: rel, present: fs.existsSync(abs) };
  });
  const missing = modules.filter((m) => !m.present).map((m) => m.path);

  let reconcileDisarmed = false;
  try {
    const recon = fs.readFileSync(
      path.join(repoRoot, "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs"),
      "utf8",
    );
    reconcileDisarmed =
      /emailOfferStagingArmed/.test(recon) &&
      /Email never changes JOINED\/ENDED/.test(recon) &&
      /authorized CJ/.test(recon);
  } catch {
    reconcileDisarmed = false;
  }

  const ownerActions = [
    "Confirm IMAP mailbox credentials for CJ affiliate inbox (secret; never commit).",
    "Confirm mailbox allows CJ program + offer notifications only (spam/forged filtered).",
    "Confirm IU_CJ_WORKERS_AI_API_TOKEN if AI classify path is desired (optional for catalog).",
    "Approve email-only publication arming only after JOINED+authorized URL reconcile burn-in.",
  ];

  const readyCode = missing.length === 0 && reconcileDisarmed;
  return {
    schema: EMAIL_TECHNICAL_READINESS_SCHEMA,
    at: new Date().toISOString(),
    publicationDefault: "DISARMED",
    codePathPresent: missing.length === 0,
    reconcileSafetyPresent: reconcileDisarmed,
    modules,
    missing,
    ownerActions,
    verdict: readyCode
      ? "TECHNICALLY_READY_PUBLICATION_DISARMED"
      : "INCOMPLETE_CODE_OR_SAFETY",
    note:
      "Email-only publication stays DISARMED. Catalog API sync must not depend on email. Email never invents JOINED/ENDED or unauthorized affiliate URLs.",
  };
}
