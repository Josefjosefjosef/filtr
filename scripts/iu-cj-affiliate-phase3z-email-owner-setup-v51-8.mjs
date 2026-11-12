/**
 * V51.8 — exact owner setup steps for CJ email ingestion (no secret values).
 * Run: node scripts/iu-cj-affiliate-phase3z-email-owner-setup-v51-8.mjs
 */
const guide = {
  schema: "iu-cj-affiliate-phase3z-email-owner-setup-v51-8",
  publicationDefault: "DISARMED",
  goal: "Enable authenticated mailbox ingest for CJ notifications; keep email-only public publish DISARMED until burn-in approval.",
  prerequisites: [
    "Dedicated CJ/affiliate mailbox (IMAP) under owner control",
    "GitHub Actions secrets writable by owner",
    "Cloudflare account for email D1 worker already used by repo",
  ],
  secretsToCreate: [
    {
      name: "IU_CJ_EMAIL_IMAP_HOST",
      where: "GitHub → Settings → Secrets → Actions",
      purpose: "IMAP hostname",
    },
    {
      name: "IU_CJ_EMAIL_IMAP_USER",
      where: "GitHub Actions secrets",
      purpose: "Mailbox username",
    },
    {
      name: "IU_CJ_EMAIL_IMAP_PASS",
      where: "GitHub Actions secrets",
      purpose: "Mailbox app password / token (never commit)",
    },
    {
      name: "IU_CJ_WORKERS_AI_API_TOKEN",
      where: "GitHub Actions secrets",
      purpose: "Optional AI classify; Account.Workers AI Edit on 577868e9aac9c289e9323100f68fad16",
      optional: true,
    },
  ],
  steps: [
    "1) Create/confirm IMAP mailbox that receives CJ partner messages only.",
    "2) Create app password / OAuth token; store ONLY in GitHub Actions secrets listed above.",
    "3) Confirm workflow .github/workflows/cj-affiliate-email-ingest.yml is enabled.",
    "4) Run workflow_dispatch once; expect ingest SUCCESS without publishing email-only offers.",
    "5) Verify reconcile: JOINED + authorized CJ tracking URL required; email never invents URL/JOINED.",
    "6) Keep emailOfferStagingArmed=false until explicit owner approval after burn-in.",
    "7) Rollback: disable workflow or remove IMAP secrets; catalog API sync continues independently.",
  ],
  verifyWithoutLeaking: [
    "Workflow log shows IMAP connect OK (no password printed)",
    "D1/registry rows increase for ingested UIDs",
    "No public offers-public growth from email-only identities while DISARMED",
    "aiAuthFailedCount may be >0 until Workers AI token fixed — must not fail catalog sync",
  ],
  doNot: [
    "Do not paste passwords/tokens into chat, commits, or artifacts",
    "Do not arm email-only publication without explicit approval",
    "Do not treat email as authority for JOINED/ENDED",
  ],
};

console.log(JSON.stringify(guide, null, 2));
