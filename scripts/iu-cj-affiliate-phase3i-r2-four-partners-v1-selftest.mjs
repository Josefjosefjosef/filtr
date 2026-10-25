#!/usr/bin/env node
/**
 * Phase 3I selftest: four-partner coverage + R2 DISARMED readiness + ops 14/14.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { buildCjR2ProductionGoPlan } from "./iu-cj-affiliate-phase3e-r2-production-go-plan-v1.mjs";
import { runAutomation24x7Matrix } from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";
import {
  reconcileCjPartnerCoverage,
  parseCatalogPartners,
} from "./iu-cj-affiliate-phase3h-coverage-reconcile-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ops = runAutomation24x7Matrix({});
expect("ops_14", ops.ok === true && ops.scenarioCount === 14 && ops.failed.length === 0, {
  failed: ops.failed,
});

const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const parsed = parseCatalogPartners(catalogSrc);
const tren = parsed.byAdv.get("5938081");
const royal = parsed.byAdv.get("5819507");
expect("tren_baked_cid", tren && tren.advertiserId === "5938081" && /Trenýrkárna/i.test(tren.title), tren);
expect("tren_url", tren && isCjTrackingUrl(tren.url));
expect("royal_baked_cid", royal && royal.advertiserId === "5819507" && /Royalfashion/i.test(royal.title), royal);
expect("royal_url", royal && isCjTrackingUrl(royal.url));
expect("royal_stable", royal && !/-\d{10,}$/.test(royal.url));
expect("catalog_has_tren_in_moda", /id:\s*"aff-moda"[\s\S]*?5938081/.test(catalogSrc));
expect("catalog_has_royal_in_sperky", /id:\s*"aff-sperky-hodinky"[\s\S]*?5819507/.test(catalogSrc));

const mp = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), "utf8")
);
const trenM = (mp.partners || []).find((p) => String(p.advertiserId) === "5938081");
const royalM = (mp.partners || []).find((p) => String(p.advertiserId) === "5819507");
expect("tren_managed", trenM && trenM.sectionId === "aff-moda" && trenM.active !== false);
expect("royal_managed", royalM && royalM.sectionId === "aff-sperky-hodinky" && royalM.active !== false);

const review = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-manual-review-v1.json"), "utf8")
);
expect("disarmed", review.liveEnabled === false && review.publishArmed === false);
expect("mr_two", (review.remainingManualReview || []).length === 2);
expect(
  "mr_ids",
  (review.remainingManualReview || []).every((r) =>
    ["5578976", "7804601"].includes(String(r.advertiserId))
  )
);
expect(
  "gavri_keep",
  (review.managedNotJoined || []).some(
    (g) => String(g.advertiserId) === "5614135" && g.decision === "KEEP_DRIFT_NOT_CONFIRMED_ENDED"
  )
);

const wrangler = fs.readFileSync(
  path.join(ROOT, "cloudflare", "iu-site-redirects", "wrangler.toml"),
  "utf8"
);
expect("live_false", /CJ_MANAGED_PUBLIC_LIVE_ENABLED\s*=\s*"false"/.test(wrangler));
expect("binding_active", /binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler));
expect("binding_not_commented", !/#\s*binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler));
expect("ndic_intact", /binding\s*=\s*"TRAFFIC_LIVE"/.test(wrangler));
expect(
  "ensure_wf",
  fs.existsSync(path.join(ROOT, ".github", "workflows", "ensure-cj-managed-public-r2-bucket.yml"))
);

const r2Missing = auditCjManagedPublicR2Readiness({
  secretsPresence: {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "MISSING",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "MISSING",
  },
});
expect("r2_code_ready", r2Missing.codeReady === true);
expect("r2_pending_without_secrets", r2Missing.infraPending === true);
expect("r2_no_prod", r2Missing.productionPublishAllowed === false);

const r2Present = auditCjManagedPublicR2Readiness({
  secretsPresence: {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "PRESENT",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "PRESENT",
  },
  bucketExists: true,
});
expect("r2_secrets_ready", r2Present.secretsReady === true);
expect("r2_infra_clear_with_secrets_bucket", r2Present.infraPending === false);
expect("r2_still_no_prod_publish", r2Present.productionPublishAllowed === false);

const plan = buildCjR2ProductionGoPlan({
  secretsPresence: {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "PRESENT",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "PRESENT",
  },
});
expect("plan_disarmed", plan.liveEnabled === false && plan.productionActionsArmed === false);

let liveSummary = { ran: false };
const livePath = path.join(
  process.env.TEMP || "",
  "iu-cj-phase3e-validation",
  "readiness",
  "iu-affiliate-cj-publication-readiness-live.json"
);
if (fs.existsSync(livePath)) {
  const liveDoc = JSON.parse(fs.readFileSync(livePath, "utf8"));
  const recon = reconcileCjPartnerCoverage({ liveDoc, root: ROOT });
  liveSummary = { ran: true, counts: recon.counts, missing: recon.missingButton };
  expect("live_joined", recon.counts.joined === 166);
  expect("live_with_button_ge_164", recon.counts.withButton >= 164, recon.counts);
  expect(
    "tren_not_missing",
    !recon.missingButton.some((m) => String(m.advertiserId) === "5938081")
  );
  expect(
    "royal_not_missing",
    !recon.missingButton.some((m) => String(m.advertiserId) === "5819507")
  );
  expect(
    "only_mr_missing",
    recon.missingButton.every((m) => ["5578976", "7804601"].includes(String(m.advertiserId))),
    recon.missingButton
  );
  expect(
    "coupons_linked",
    recon.counts.couponsLinkedToButton === recon.counts.couponsPublicationReady
  );
  expect(
    "actions_linked",
    recon.counts.actionsLinkedToButton === recon.counts.actionsPublicationReady
  );
}

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3I_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    ops: { ok: ops.ok, passed: ops.passed, scenarioCount: ops.scenarioCount },
    liveSummary,
    r2: {
      codeReady: r2Present.codeReady,
      secretsReady: r2Present.secretsReady,
      infraPendingWithSecrets: r2Present.infraPending,
      productionPublishAllowed: r2Present.productionPublishAllowed,
      bindingActive: r2Present.bindingActive,
    },
  })
);
process.exit(ok ? 0 : 1);
