/**
 * Machine-readable map of InfoUzel Ads regression freeze coverage.
 * Updated with inventory PR B; consumed by test/regression-freeze-manifest.test.ts and CI.
 */

export type RegressionFreezeArea = {
  /** Stable id for reports and CI grouping */
  id: string;
  label_cs: string;
  /** Vitest paths under cloudflare/iu-ads/ */
  vitest: string[];
  /** Node guard scripts under repo scripts/ (repo root relative) */
  guard_scripts: string[];
  /** Covered on every Deploy IU Ads (main push) */
  on_deploy_iu_ads: boolean;
  /** Part of PR workflow iu-ads-regression-freeze.yml */
  on_pr_regression_workflow: boolean;
  gaps?: string;
};

/** Repository-wide required GitHub status contexts (branch protection). */
export const REPO_REQUIRED_STATUS_CONTEXTS = ["layout-guard", "repo-guard", "smoke"] as const;

/** Guards executed in Deploy IU Ads before wrangler deploy (see .github/workflows/deploy-iu-ads.yml). */
export const DEPLOY_IU_ADS_GUARD_SCRIPTS = [
  "scripts/iu-ads-migration-schema-compat-guard-v1.mjs",
  "scripts/iu-premium-public-admin-consistency-guard-v1.mjs",
  "scripts/iu-premium-admin-order-documents-guard-v1.mjs",
  "scripts/iu-premium-selected-services-freeze-guard-v1.mjs",
  "scripts/iu-ads-admin-menu-guard-v1.mjs",
  "scripts/iu-ads-admin-zip-search-guard-v1.mjs",
  "scripts/iu-premium-order-documents-freeze-guard-v1.mjs",
  "scripts/iu-premium-invoice-pdf-freeze-guard-v1.mjs",
  "scripts/iu-premium-order-confirmation-pdf-freeze-guard-v1.mjs",
  "scripts/iu-premium-dev-operational-reset-guard-v1.mjs",
  "scripts/iu-future-pc-banner-boundary-guard-v1.mjs",
] as const;

export const REGRESSION_FREEZE_AREAS: RegressionFreezeArea[] = [
  {
    id: "public_order_forms",
    label_cs: "Veřejné objednávkové formuláře (premium selected)",
    vitest: [
      "test/premium-order-form-e2e.test.ts",
      "test/premium-order-b2b.test.ts",
      "test/premium-order-ui.test.ts",
      "test/premium-order-script-smoke.test.ts",
      "test/premium-terms-archive.test.ts",
      "test/czech-ico.test.ts",
      "test/premium-ares-registry.test.ts",
    ],
    guard_scripts: [
      "scripts/iu-premium-order-form-guard-v1.mjs",
      "scripts/iu-premium-order-file-flow-guard-v1.mjs",
      "scripts/iu-premium-order-preview-parity-guard-v1.mjs",
    ],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
  },
  {
    id: "catalog_p1_p8",
    label_cs: "Katalog sekcí, pozice P1–P8, ceny",
    vitest: [
      "test/premium-security.test.ts",
      "test/premium-sales-availability.test.ts",
      "test/premium-affiliate-catalog-titles.test.ts",
      "test/collision.test.ts",
      "test/premium-order-submit-d1.integration.test.ts",
    ],
    guard_scripts: [
      "scripts/iu-premium-selected-services-freeze-guard-v1.mjs",
      "scripts/iu-premium-affiliate-catalog-titles-parity-guard-v1.mjs",
      "scripts/iu-premium-selected-render-guard-v1.mjs",
    ],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
  },
  {
    id: "order_lifecycle",
    label_cs: "Objednávky, schválení, zveřebnění, prodloužení, storno",
    vitest: [
      "test/premium-order-chain.test.ts",
      "test/premium-admin-lifecycle.test.ts",
      "test/premium-order-publishable.test.ts",
      "test/premium-publication-consistency.test.ts",
      "test/premium-ad-turnoff-storno.test.ts",
      "test/premium-order-accounting-cancel.test.ts",
      "test/reservations.test.ts",
      "test/premium-admin-extend-new-order.integration.test.ts",
      "test/premium-order-submit-d1.integration.test.ts",
      "test/premium-admin-approve-d1.integration.test.ts",
    ],
    guard_scripts: ["scripts/iu-premium-public-admin-consistency-guard-v1.mjs"],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
  },
  {
    id: "billing_documents",
    label_cs: "Fakturace, dobropisy, PDF, archiv",
    vitest: [
      "test/premium-invoice-pdf-layout.test.ts",
      "test/premium-invoice-spayd-qr.test.ts",
      "test/premium-order-documents.test.ts",
      "test/premium-order-detail-documents.test.ts",
      "test/premium-order-document-revisions.test.ts",
      "test/premium-order-confirmation-pdf-layout.test.ts",
      "test/premium-order-cancellation-pdf-layout.test.ts",
      "test/premium-order-confirmation-visual-freeze.test.ts",
      "test/premium-invoice-visual-freeze.test.ts",
      "test/premium-pdf-seven-scenarios-visual.test.ts",
      "test/premium-storno-credit-visual-proof.test.ts",
      "test/premium-accounting-settlement.test.ts",
    ],
    guard_scripts: [
      "scripts/iu-premium-order-documents-freeze-guard-v1.mjs",
      "scripts/iu-premium-invoice-pdf-freeze-guard-v1.mjs",
      "scripts/iu-premium-order-confirmation-pdf-freeze-guard-v1.mjs",
      "scripts/iu-premium-admin-order-documents-guard-v1.mjs",
    ],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
  },
  {
    id: "admin_ui",
    label_cs: "Administrace (UI, navigace, dokumenty)",
    vitest: [
      "test/admin-premium-orders-nav.e2e.test.ts",
      "test/admin-nav-catalog.test.ts",
      "test/ui-shells.test.ts",
      "test/admin-finance.test.ts",
      "test/premium-order-history-labels.test.ts",
      "test/premium-admin-approve-d1.integration.test.ts",
    ],
    guard_scripts: [
      "scripts/iu-ads-admin-menu-guard-v1.mjs",
      "scripts/iu-ads-admin-zip-search-guard-v1.mjs",
    ],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
  },
  {
    id: "dev_reset",
    label_cs: "Vývojový reset testovacích dat",
    vitest: [
      "test/premium-dev-operational-reset-guard.test.ts",
      "test/premium-order-test-data-reset.integration.test.ts",
      "test/premium-order-delete-purge.integration.test.ts",
    ],
    guard_scripts: ["scripts/iu-premium-dev-operational-reset-guard-v1.mjs"],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
    gaps: "Produkční reset pouze s PREMIUM_DEV_OPERATIONAL_RESET_ENABLED + hlavní admin; bez workflow_dispatch na prod.",
  },
  {
    id: "d1_r2",
    label_cs: "D1 schéma, vazby, R2",
    vitest: [
      "test/r2-security.test.ts",
      "test/backup-security.test.ts",
      "test/isolated-restore-drill.test.ts",
      "test/premium-order-delete.test.ts",
      "test/iu-ads-schema-migration-compat.test.ts",
    ],
    guard_scripts: ["scripts/iu-ads-migration-schema-compat-guard-v1.mjs"],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
    gaps: "Prod migrace: iu-ads-post-migration-prod-verify.yml po apply migrace.",
  },
  {
    id: "public_delivery_web",
    label_cs: "Veřejné zobrazování reklam (infoUzel.cz)",
    vitest: [
      "test/public-delivery-route.test.ts",
      "test/delivery-engine.test.ts",
      "test/public-inject.test.ts",
      "test/premium-extend-public-delivery.integration.test.ts",
      "test/premium-display-compaction.test.ts",
      "test/premium-public-delivery-d1.integration.test.ts",
    ],
    guard_scripts: [
      "scripts/iu-premium-display-compaction-guard-v1.mjs",
      "scripts/iu-premium-selected-no-tracking-guard-v1.mjs",
    ],
    on_deploy_iu_ads: false,
    on_pr_regression_workflow: true,
    gaps: "Produkce: publicDeliveryEnabled=false v /health; plný prod smoke = workflow_dispatch (iu-ads-client-e2e-prod, iu-premium-selected-prod-smoke-bounded).",
  },
  {
    id: "privacy",
    label_cs: "Soukromí (bez cookies, fingerprintu, prokliků)",
    vitest: ["test/premium-security.test.ts", "test/security-headers.test.ts"],
    guard_scripts: [
      "scripts/iu-premium-selected-services-freeze-guard-v1.mjs",
      "scripts/iu-premium-selected-no-tracking-guard-v1.mjs",
    ],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
  },
  {
    id: "future_pc_banner_boundary",
    label_cs: "Budoucí PC bannery (hraniční architektura, bez produktu)",
    vitest: ["test/future-pc-banner-boundary.test.ts"],
    guard_scripts: ["scripts/iu-future-pc-banner-boundary-guard-v1.mjs"],
    on_deploy_iu_ads: true,
    on_pr_regression_workflow: true,
    gaps: "Produkt PC bannerů neimplementován — pouze placeholder /v1/admin/banner-pc.",
  },
];

export function uniqueVitestForPrWorkflow(): string[] {
  const set = new Set<string>();
  for (const area of REGRESSION_FREEZE_AREAS) {
    if (!area.on_pr_regression_workflow) continue;
    for (const f of area.vitest) set.add(f);
  }
  return [...set].sort();
}

export function uniqueGuardScriptsForPrWorkflow(): string[] {
  const set = new Set<string>();
  for (const area of REGRESSION_FREEZE_AREAS) {
    if (!area.on_pr_regression_workflow) continue;
    for (const s of area.guard_scripts) set.add(s);
  }
  return [...set].sort();
}
