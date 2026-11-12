/**
 * V51.8 — Workers AI role vs CJ catalog pipeline.
 * Catalog product sync must continue when Workers AI returns HTTP 401.
 */
import fs from "node:fs";
import path from "node:path";

export const WORKERS_AI_CATALOG_ROLE_SCHEMA =
  "iu-cj-affiliate-phase3z-workers-ai-catalog-role-v51-8";

export function evaluateWorkersAiCatalogRole(repoRoot = process.cwd()) {
  const liveSync = fs.readFileSync(
    path.join(repoRoot, "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs"),
    "utf8",
  );
  const catalogUsesWorkersAi =
    /workersAiHttpClassifyEvent|IU_CJ_WORKERS_AI|WORKERS_AI/.test(liveSync) &&
    /from\s+".\/iu-cj-affiliate-phase2-workers-ai-adapter/.test(liveSync);

  const guidePresent = fs.existsSync(
    path.join(repoRoot, "scripts/iu-cj-affiliate-phase3s-workers-ai-token-setup-guide-v1.mjs"),
  );
  const probePresent = fs.existsSync(
    path.join(repoRoot, "scripts/iu-cj-affiliate-phase3r-workers-ai-probe-v1.mjs"),
  );

  return {
    schema: WORKERS_AI_CATALOG_ROLE_SCHEMA,
    at: new Date().toISOString(),
    role: "SUPPLEMENTARY_EMAIL_CLASSIFY",
    requiredForCatalogProductSync: false,
    catalogPipelineImportsWorkersAi: catalogUsesWorkersAi === true,
    http401Impact:
      "Blocks optional email AI classify path only; product/coupon/promotion API sync continues.",
    ownerFixGuidePresent: guidePresent,
    probePresent,
    publicationArmed: false,
    ownerStepsRef: "scripts/iu-cj-affiliate-phase3s-workers-ai-token-setup-guide-v1.mjs",
    verdict:
      catalogUsesWorkersAi === true
        ? "REGRESSION_CATALOG_COUPLED_TO_WORKERS_AI"
        : "NON_BLOCKING_SUPPLEMENTARY",
    note:
      "HTTP 401 on Workers AI is BLOCKED_OWNER_ACTION for email AI assist; not a catalog stop-ship when non-blocking.",
  };
}
