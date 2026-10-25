#!/usr/bin/env node
/**
 * Phase 3E — partner recon + expanded product sample + readiness refresh (DISARMED).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clearCjEnvFromProcess, finishNodeProcessAfterNetwork, readJson } from "./iu-cj-affiliate-phase1-lib.mjs";
import { readCjPatFromEnv } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import { runPhase3ePartnerRecon, buildSectionMapFile } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";
import { auditAffiliateSectionCapacity } from "./iu-cj-affiliate-phase3e-capacity-audit-v1.mjs";
import { buildCjR2ProductionGoPlan } from "./iu-cj-affiliate-phase3e-r2-production-go-plan-v1.mjs";
import { runPhase3dCompleteValidation } from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";
import { runAutomation24x7Matrix } from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runPhase3eCompleteValidation(opts = {}) {
  const env = opts.env || process.env;
  const outDir = opts.outDir || path.join(process.env.TEMP || "/tmp", "iu-cj-phase3e-validation");
  const writeRepoSectionMap = opts.writeRepoSectionMap === true;

  const capacity = auditAffiliateSectionCapacity();
  const r2Plan = buildCjR2ProductionGoPlan({
    secretsPresence: {
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: env.IU_CJ_R2_URL_PRESENT === "1" ? "PRESENT" : "MISSING",
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: env.IU_CJ_R2_TOKEN_PRESENT === "1" ? "PRESENT" : "MISSING",
    },
  });

  const recon = await runPhase3ePartnerRecon({ env, outDir: path.join(outDir, "recon") });
  if (!recon.ok) {
    return {
      ok: false,
      reason: recon.report.reason,
      recon,
      capacity,
      r2Plan,
      liveEnabled: false,
      publishArmed: false,
    };
  }

  // Persist proposed section map into repo data when explicitly requested (PR path)
  if (writeRepoSectionMap) {
    const mapDoc = buildSectionMapFile(recon.proposal.sectionMap, {
      source: "phase3e_complete_validation",
      updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(
      path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"),
      JSON.stringify(mapDoc, null, 2) + "\n"
    );
  }

  const productPartnerLimit = Number(opts.productPartnerLimit || env.IU_CJ_PHASE3E_PRODUCT_PARTNERS || 122);
  const productLimitPerPartner = Number(opts.productLimitPerPartner || env.IU_CJ_PHASE3E_PRODUCTS_PER || 5);

  const validation = await runPhase3dCompleteValidation({
    env,
    outDir: path.join(outDir, "readiness"),
    productPartnerLimit,
    productLimitPerPartner,
    maxAdvPages: 40,
    maxLinkPages: 40,
  });

  const automation24x7 = runAutomation24x7Matrix({
    env,
    forceAuthScenario: true,
    sectionByAdv: recon.proposal?.reconciliation?.sectionByAdv || {},
  });

  const summary = {
    schema: "iu-cj-phase3e-complete-validation-v1",
    at: new Date().toISOString(),
    ok: Boolean(validation.ok),
    liveEnabled: false,
    publishArmed: false,
    catalogMutated: false,
    recon: {
      joined: recon.report.joined,
      autoAssigned: recon.report.autoAssignedCount,
      stillManual: recon.report.stillManualReviewCount,
      assignedToSections: recon.report.assignedToSections,
      manualReviewCount: recon.report.manualReviewCount,
      managedNotJoined: recon.report.managedNotJoined,
      freeEmptySlots: recon.report.freeEmptySlots,
    },
    capacity: {
      freeEmptySlotCount: capacity.freeEmptySlotCount,
      occupiedButtonCount: capacity.occupiedButtonCount,
      emptySections: capacity.emptySections,
      proposalNeedsGo: true,
    },
    readiness: validation.report?.stats || null,
    products: {
      sampledPartners: validation.report?.stats?.productsPartnersSampled ?? null,
      partnersWithFeed: validation.report?.stats?.productsPartnersWithFeed ?? null,
      partnersEmptyFeed: validation.report?.stats?.productsPartnersEmptyFeed ?? null,
      partnersError: validation.report?.stats?.productsPartnersError ?? null,
      productsLoaded: validation.report?.stats?.productsLoaded ?? null,
      productsWithPhotoAndPrice: validation.report?.stats?.productsWithPhotoAndPrice ?? null,
    },
    r2Plan: {
      productionActionsArmed: r2Plan.productionActionsArmed,
      infraPending: r2Plan.auditSummary.infraPending,
      steps: r2Plan.steps.length,
    },
    automation24x7: {
      ok: automation24x7.ok,
      passed: automation24x7.passed,
      scenarioCount: automation24x7.scenarioCount,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "phase3e-complete-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");

  return {
    ok: summary.ok,
    summary,
    summaryPath,
    recon,
    validation,
    capacity,
    r2Plan,
    automation24x7,
    outDir,
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const writeMap = process.env.IU_CJ_PHASE3E_WRITE_SECTION_MAP === "1";
  runPhase3eCompleteValidation({ writeRepoSectionMap: writeMap })
    .then(async (r) => {
      console.log(
        JSON.stringify({
          IU_CJ_PHASE3E_COMPLETE_VALIDATION: r.ok ? "OK" : "FAIL",
          summaryPath: r.summaryPath,
          recon: r.summary.recon,
          readiness: r.summary.readiness,
          products: r.summary.products,
          capacityFreeEmpty: r.summary.capacity.freeEmptySlotCount,
          r2Armed: r.summary.r2Plan.productionActionsArmed,
          automationOk: r.summary.automation24x7.ok,
          liveEnabled: false,
          publishArmed: false,
        })
      );
      await finishNodeProcessAfterNetwork(r.ok ? 0 : 1);
    })
    .catch(async (e) => {
      console.error(String(e?.stack || e));
      clearCjEnvFromProcess();
      process.exit(1);
    });
}
