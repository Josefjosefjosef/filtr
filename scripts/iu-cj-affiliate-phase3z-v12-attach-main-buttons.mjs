#!/usr/bin/env node
/**
 * Phase 3Z V12 — surgical attach of MAIN_BUTTON_READY onto existing registry JSON.
 * Does NOT re-run URL verification (avoids READY wipe). Does NOT arm PUBLIC_SWAP.
 *
 * Usage:
 *   node scripts/iu-cj-affiliate-phase3z-v12-attach-main-buttons.mjs
 *   IU_CJ_PHASE3Z_WRITE_REPO=1 node scripts/iu-cj-affiliate-phase3z-v12-attach-main-buttons.mjs --write-repo
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { attachMainButtonReadiness } from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";
import { buildDefaultMainButtonEmailHintMap } from "./iu-cj-affiliate-phase3z-main-button-email-hints-v12.mjs";
import { applyMerchantEvidenceOverride } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function main() {
  // Prefer explicit env only when it still points under projects/data (never TEMP rebuild leftovers).
  const envReg = process.env.IU_CJ_PHASE3Z_REGISTRY_PATH || "";
  const envBtn = process.env.IU_CJ_PHASE3Z_BUTTONS_PATH || "";
  const defaultReg = path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json");
  const defaultBtn = path.join(
    ROOT,
    "projects",
    "data",
    "iu-affiliate-cj-partner-buttons-preview-v1.json"
  );
  const regPath =
    envReg && /projects[\\/]+data[\\/]+iu-affiliate-cj-partner-registry-v1\.json$/i.test(envReg)
      ? envReg
      : defaultReg;
  const btnPath =
    envBtn && /projects[\\/]+data[\\/]+iu-affiliate-cj-partner-buttons/i.test(envBtn)
      ? envBtn
      : defaultBtn;

  const registry = readJson(regPath);
  registry.publicButtonSwapArmed = false;
  registry.liveEnabled = false;
  registry.cjFirstMainButtonArchitecture = "IMPLEMENTED";
  registry.merchantWebCrawlRequiredForMainButton = false;
  registry.couponProductRefactor = "DEFERRED";

  // Apply Allegro (and any other) evidence section fixes without full rebuild.
  for (const p of registry.partners || []) {
    const ov = applyMerchantEvidenceOverride({
      advertiserId: p.advertiserId,
      assortment: { merchantType: p.merchantType },
      baseSectionId: p.sectionId || null,
    });
    if (ov.applied && ov.sectionId && !ov.categoryReviewRequired) {
      if (!p.sectionId || p.sectionId !== ov.sectionId) {
        p.sectionId = ov.sectionId;
        p.sectionSource = "merchant_evidence_v9_cj_first_v12";
        p.cjFirstSectionApplied = true;
        if (p.holdReason === "CATEGORY_REVIEW_REQUIRED") {
          p.holdReason = null;
          // Keep publishability untouched for legacy PUBLICATION_READY; MAIN_BUTTON is separate.
        }
      }
    }
  }

  const summary = attachMainButtonReadiness(registry, {
    emailHintsByAdvertiserId: buildDefaultMainButtonEmailHintMap(),
  });

  // Document automatic remediation for remaining real blockers (no fabricated click URLs).
  const stagingPath = path.join(ROOT, "projects", "data", "iu-affiliate-cj-staging-v1.json");
  let stagingLinksByAdv = new Map();
  try {
    if (fs.existsSync(stagingPath)) {
      const staging = readJson(stagingPath);
      for (const l of staging.links || []) {
        const id = String(l.advertiserId || "");
        if (!id) continue;
        if (!stagingLinksByAdv.has(id)) stagingLinksByAdv.set(id, []);
        stagingLinksByAdv.get(id).push(l);
      }
    }
  } catch {
    stagingLinksByAdv = new Map();
  }
  for (const row of summary.remainingBlockers || []) {
    const links = stagingLinksByAdv.get(String(row.advertiserId)) || [];
    row.remediationAttempts = [
      {
        step: "cj_link_search_full_scan",
        linkCount: links.length,
        result:
          links.length === 0
            ? "no_links_in_staging_snapshot"
            : "all_authorized_links_have_unsuitable_customer_destinations",
      },
      {
        step: "no_fabricated_tracking_url",
        result: "skipped_programurl_without_authorized_cj_click",
      },
    ];
    row.nextFeasibleFix =
      "Obtain authorized CJ homepage/service deep-link via Link Search refresh or advertiser; do not invent click URL.";
  }
  registry.mainButtonSummary = summary;

  let buttons = null;
  if (fs.existsSync(btnPath)) {
    buttons = readJson(btnPath);
    buttons.publicButtonSwapArmed = false;
    buttons.mainButtonSummary = summary;
  }

  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(regPath);
    writeJson(regPath, registry);
    if (buttons) {
      assertAllowedDataWrite(btnPath);
      writeJson(btnPath, buttons);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: writeRepo,
        registryPath: regPath,
        publicButtonSwapArmed: false,
        mainButtonSummary: summary,
      },
      null,
      2
    )
  );
}

main();
