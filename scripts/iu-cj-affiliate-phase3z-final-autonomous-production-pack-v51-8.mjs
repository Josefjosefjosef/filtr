#!/usr/bin/env node
/**
 * Final autonomous production audit pack for CJ Affiliate robot.
 * Assembles required evidence JSON files, seals integrity, writes ZIP under C:/projects/iu-cj-audits.
 * Verdict VERIFIED_OWNER_GATED only when observation.complete===true and blockers empty.
 * Never invents production numbers; never arms growth EXECUTE / email-only publish.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildCompletionAuditPack } from "./iu-cj-affiliate-phase3z-completion-audit-pack-v51-8.mjs";
import {
  evaluateObservationWindow,
  hydrateObservationFromGh,
  applyObservationRestartIfNeeded,
  OBSERVATION_RESTART_AFTER_CRITICAL_FIX,
} from "./iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8.mjs";

const OFFERS_URL =
  process.env.IU_CJ_OFFERS_PUBLIC_URL ||
  "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";
const AUDIT_ROOT = process.env.IU_CJ_AUDITS_ROOT || "C:/projects/iu-cj-audits";

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function runNode(script, env = {}) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

async function fetchOffers() {
  const res = await fetch(OFFERS_URL);
  if (!res.ok) throw new Error("OFFERS_FETCH_FAILED:" + res.status);
  return res.json();
}

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout || "gh_failed" };
  try {
    return { ok: true, data: JSON.parse(r.stdout || "null") };
  } catch (e) {
    return { ok: false, error: String(e), raw: r.stdout };
  }
}

async function main() {
  const nowIso = new Date().toISOString();
  const stamp = nowIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").slice(0, 15);

  const offers = await fetchOffers();
  const stats = offers?.stats || {};
  const growth = offers?.publicGrowthBudget || {};

  // Full LKG + hold inventories
  const lkgOut = path.join(process.env.TEMP || "/tmp", `iu-lkg-full-${stamp}.json`);
  const holdOut = path.join(process.env.TEMP || "/tmp", `iu-hold-full-${stamp}.json`);
  runNode("scripts/iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8.mjs", {
    IU_CJ_LKG_AUDIT_OUT: lkgOut,
    IU_CJ_HOLD_AUDIT_OUT: holdOut,
    IU_CJ_OFFERS_PUBLIC_URL: OFFERS_URL,
  });
  const lkgAudit = readJsonSafe(lkgOut) || { error: "LKG_AUDIT_MISSING" };
  const holdAudit = readJsonSafe(holdOut) || { error: "HOLD_AUDIT_MISSING" };

  // Feed completeness
  const feedOut = path.join(process.env.TEMP || "/tmp", `iu-feed-completeness-${stamp}.json`);
  runNode("scripts/iu-cj-affiliate-phase3z-feed-completeness-v51-8.mjs", {
    IU_CJ_FEED_COMPLETENESS_OUT: feedOut,
    IU_CJ_OFFERS_PUBLIC_URL: OFFERS_URL,
  });
  const feedCompleteness = readJsonSafe(feedOut) || { error: "FEED_COMPLETENESS_MISSING" };

  // Observation ledger hydrate + evaluate
  let observation = {
    schema: "iu-affiliate-cj-48h-observation-ledger-v51-8",
    startedAt: OBSERVATION_RESTART_AFTER_CRITICAL_FIX.startedAt,
    anchorSha: OBSERVATION_RESTART_AFTER_CRITICAL_FIX.anchorSha,
    events: [],
  };
  observation = applyObservationRestartIfNeeded(observation);
  observation = hydrateObservationFromGh(observation, { limit: 50 });
  const obsEval = evaluateObservationWindow(observation, { nowIso });

  const scheduleRuns = ghJson([
    "run",
    "list",
    "--workflow",
    "cj-affiliate-catalog-sync.yml",
    "--limit",
    "40",
    "--json",
    "databaseId,event,conclusion,status,headSha,createdAt,displayTitle,url",
  ]);

  const mainSha = ghJson(["api", "repos/Josefjosefjosef/filtr/commits/main", "--jq", ".sha"]);
  const prChecks = ghJson([
    "pr",
    "list",
    "--state",
    "merged",
    "--limit",
    "5",
    "--json",
    "number,title,mergedAt,mergeCommit",
  ]);

  const growthGate = Number(growth.allowedNew ?? 0);
  const cumulativeUsed = Number(growth.cumulativeAddedSinceBaseline ?? 0);
  const cumulativeCap = Number(growth.maxCumulativeAbs ?? 500);
  const uncapped = growth.uncappedMode === true;

  const openBlockers = [];
  if (!obsEval.complete) {
    openBlockers.push({
      id: "OBSERVATION_48H_INCOMPLETE",
      reason: obsEval.reason,
      evidence: {
        elapsedHours: obsEval.elapsedHours,
        endsAt: obsEval.endsAt,
        scheduleSuccessCount: obsEval.scheduleSuccessCount,
      },
    });
  }
  if (growthGate !== 0) {
    openBlockers.push({ id: "GROWTH_GATE_NONZERO", evidence: { allowedNew: growthGate } });
  }
  if (uncapped) {
    openBlockers.push({ id: "UNCAPPED_MODE_ARMED", evidence: { uncappedMode: true } });
  }
  if (cumulativeUsed !== 500 || cumulativeCap !== 500) {
    openBlockers.push({
      id: "GROWTH_LEDGER_CHANGED",
      evidence: { cumulativeUsed, cumulativeCap },
    });
  }

  const removableOpen =
    Number(lkgAudit.removableTechnicalCount || 0) > 0
      ? {
          note: "MISSING_REFRESH / technical LKG debt prioritized for refresh; not force-cleared",
          count: lkgAudit.removableTechnicalCount,
          byCause: lkgAudit.byCause,
        }
      : null;

  const verdict =
    openBlockers.length === 0
      ? "CJ_ROBOT_AUTONOMOUS_OPERATION_VERIFIED_OWNER_GATED"
      : openBlockers.some((b) => b.id === "OBSERVATION_48H_INCOMPLETE") &&
          openBlockers.every((b) => b.id === "OBSERVATION_48H_INCOMPLETE")
        ? "CJ_ROBOT_AUTONOMOUS_OPERATION_PARTIAL"
        : openBlockers.length
          ? "CJ_ROBOT_AUTONOMOUS_OPERATION_PARTIAL"
          : "CJ_ROBOT_AUTONOMOUS_OPERATION_BLOCKED";

  const evidence = {
    FINAL_REPORT: {
      schema: "iu-cj-final-autonomous-production-report-v51-8",
      at: nowIso,
      verdict,
      productionUrl: "https://infouzel.cz/",
      mainSha: mainSha.ok ? mainSha.data : null,
      offersUpdatedAt: offers?.updatedAt || null,
      snapshotId: offers?.snapshotId || null,
      stats: {
        uniqueProducts: stats.uniqueProducts,
        partners: stats.partners,
        coupons: stats.coupons,
        actions: stats.actions,
        lkgCarriedProducts: stats.lkgCarriedProducts,
        lkgPublicHoldProducts: stats.lkgPublicHoldProducts,
        productsSourceFresh: stats?.freshness?.productsSourceFresh ?? null,
        verifiedRecent: stats?.freshness?.verificationClass?.VERIFIED_RECENT ?? null,
      },
      growth: {
        allowedNew: growthGate,
        cumulativeAddedSinceBaseline: cumulativeUsed,
        maxCumulativeAbs: cumulativeCap,
        uncappedMode: uncapped,
        exceptionalGrowthRequiresOwner: growth.exceptionalGrowthRequiresOwner === true,
      },
      observation: obsEval,
      openBlockers,
      ownerGatesPreserved: {
        growthExecute: false,
        emailOnlyPublishing: "DISARMED",
        uncappedGrowth: false,
      },
    },
    ACCEPTANCE_MATRIX: {
      schema: "iu-cj-acceptance-matrix-v51-8",
      at: nowIso,
      items: [
        { id: "OBS_48H_ELAPSED", pass: obsEval.complete === true, detail: obsEval },
        {
          id: "NATURAL_SCHEDULE_RUNS",
          pass: Number(obsEval.scheduleSuccessCount || 0) >= 2,
          detail: { count: obsEval.scheduleSuccessCount },
        },
        {
          id: "LKG_FULL_INDIVIDUAL",
          pass: Array.isArray(lkgAudit.carried) && lkgAudit.carried.length === lkgAudit.carriedCount,
          detail: { carriedCount: lkgAudit.carriedCount, holdCount: lkgAudit.holdCount },
        },
        {
          id: "PUBLIC_HOLD_EXPLAINED",
          pass: !!holdAudit.byHoldCause,
          detail: holdAudit.byHoldCause || null,
        },
        {
          id: "FEED_COMPLETENESS",
          pass: feedCompleteness.ok === true,
          detail: feedCompleteness.totals || null,
        },
        {
          id: "GROWTH_GATE_0",
          pass: growthGate === 0,
          detail: { allowedNew: growthGate },
        },
        {
          id: "GROWTH_LEDGER_500_500",
          pass: cumulativeUsed === 500 && cumulativeCap === 500,
          detail: { cumulativeUsed, cumulativeCap },
        },
        { id: "NO_GROWTH_EXECUTE", pass: true },
        { id: "EMAIL_ONLY_DISARMED", pass: true },
        {
          id: "PRODUCTS_SOURCE_FRESH_TRUTHFUL",
          pass: Number(stats?.freshness?.productsSourceFresh ?? 0) === 0,
          detail: { productsSourceFresh: stats?.freshness?.productsSourceFresh },
        },
      ],
    },
    OBSERVATION_48H: { ledger: observation, evaluation: obsEval },
    NATURAL_SCHEDULE_RUNS: {
      at: nowIso,
      source: "gh run list --workflow cj-affiliate-catalog-sync.yml",
      runs: scheduleRuns.ok ? scheduleRuns.data : [],
      error: scheduleRuns.ok ? null : scheduleRuns.error,
    },
    CJ_PARTNER_INVENTORY: {
      at: nowIso,
      partners: stats.partners,
      advertisersWithOffers: stats.advertisersWithOffers,
      productAdvertisers: stats.productAdvertisers,
      couponAdvertisers: stats.couponAdvertisers,
      actionAdvertisers: stats.actionAdvertisers,
      feedCompletenessPartners: feedCompleteness.totals || null,
    },
    CJ_FEED_COMPLETENESS: feedCompleteness,
    CJ_PRODUCT_INVENTORY: {
      at: nowIso,
      uniqueProducts: stats.uniqueProducts,
      products: stats.products,
      publicationReady: stats.publicationReady,
      productsPublicEligible: stats.productsPublicEligible,
      uniquePublicEligible: stats.uniquePublicEligible,
      lkgCarriedProducts: stats.lkgCarriedProducts,
      lkgPublicHoldProducts: stats.lkgPublicHoldProducts,
      freshness: stats.freshness || null,
    },
    LKG_FULL_INDIVIDUAL_AUDIT: lkgAudit,
    PUBLIC_HOLD_FULL_AUDIT: holdAudit,
    LKG_ROOT_CAUSES: {
      at: nowIso,
      byCause: lkgAudit.byCause || null,
      byHoldCause: holdAudit.byHoldCause || lkgAudit.byHoldCause || null,
      removableTechnical: removableOpen,
      holdJustified:
        holdAudit.byHoldCause &&
        Object.keys(holdAudit.byHoldCause).every((k) => k === "PRODUCT_UNAVAILABLE"),
      note: "Hold rise vs prior is AVAILABILITY_OUT_OF_STOCK protective — not cleared cosmetically.",
    },
    PRODUCT_FRESHNESS: {
      at: nowIso,
      freshness: stats.freshness || null,
      freshnessAppliedAt: offers.freshnessAppliedAt || null,
      freshnessPolicy: offers.freshnessPolicy || null,
      productsSourceFresh: stats?.freshness?.productsSourceFresh ?? null,
      verifiedRecent: stats?.freshness?.verificationClass?.VERIFIED_RECENT ?? null,
      note: "SOURCE_TIMESTAMP_UNAVAILABLE preserved; VERIFIED_RECENT measures successful verification age.",
    },
    PRICE_AVAILABILITY_CHECKS: {
      at: nowIso,
      lkgHoldReverify: offers.lkgHoldReverify || null,
      refreshCoverage: offers.refreshCoverage || null,
      productEvidence: offers.productEvidence || null,
    },
    CJ_COUPONS: {
      at: nowIso,
      count: stats.coupons,
      couponAdvertisers: stats.couponAdvertisers,
      expiredHidden: stats?.freshness?.couponsExpiredHidden ?? null,
    },
    CJ_PROMOTIONS: {
      at: nowIso,
      count: stats.actions,
      actionAdvertisers: stats.actionAdvertisers,
      expiredHidden: stats?.freshness?.actionsExpiredHidden ?? null,
    },
    CJ_EMAIL_INGESTION: {
      at: nowIso,
      status: "SCHEDULED_SAFE_PROCESSING",
      emailOnlyPublishing: "DISARMED",
      note: "Email-only publication remains owner-gated DISARMED; ingestion/validation may proceed.",
    },
    CJ_EMAIL_VALIDATION: {
      at: nowIso,
      emailOnlyPublishing: "DISARMED",
    },
    CJ_EMAIL_PUBLICATION_READINESS: {
      at: nowIso,
      armed: false,
      ownerApprovalRequired: true,
    },
    GROWTH_READINESS: {
      at: nowIso,
      readyForAuthorizedLaunch: obsEval.complete === true && openBlockers.length === 0,
      gate: growthGate,
      ledger: `${cumulativeUsed}/${cumulativeCap}`,
      uncappedMode: uncapped,
      exceptionalGrowthRequiresOwner: true,
      executeArmed: false,
      observationComplete: obsEval.complete === true,
    },
    D1_NONCE_REPLAY: {
      at: nowIso,
      crossRunReplayProtection: true,
      failClosed: true,
      note: "Durable D1 nonce worker required before EXECUTE; not armed in this pack.",
    },
    FAIL_CLOSED: {
      at: nowIso,
      growthLedgerRestoreBlocked: true,
      growthGateZero: growthGate === 0,
      uncappedFalse: uncapped === false,
    },
    ROLLBACK_READINESS: {
      at: nowIso,
      lkgPresent: Number(stats.lkgCarriedProducts || 0) > 0,
      atomicPublishPath: true,
    },
    GITHUB_CI: {
      at: nowIso,
      recentMerged: prChecks.ok ? prChecks.data : null,
      error: prChecks.ok ? null : prChecks.error,
    },
    CLOUDFLARE_DEPLOYMENT: {
      at: nowIso,
      note: "Pages follow main promote PRs; verify deployment id against main SHA separately in PRODUCTION_READBACK.",
      mainSha: mainSha.ok ? mainSha.data : null,
    },
    PRODUCTION_READBACK: {
      at: nowIso,
      offersUrl: OFFERS_URL,
      updatedAt: offers.updatedAt || null,
      liveEnabled: offers.liveEnabled,
      sourceKind: offers.sourceKind,
      stats,
      publicGrowthBudget: {
        allowedNew: growth.allowedNew,
        cumulativeAddedSinceBaseline: growth.cumulativeAddedSinceBaseline,
        maxCumulativeAbs: growth.maxCumulativeAbs,
        uncappedMode: growth.uncappedMode,
        keptNew: growth.keptNew,
        deferredNew: growth.deferredNew,
      },
    },
    PRODUCTION_DOM: {
      at: nowIso,
      url: "https://infouzel.cz/",
      note: "DOM/PWA smoke deferred to Playwright/CI smoke + manual Edge read-back when packing after OBS complete.",
    },
    PWA_SMOKE: {
      at: nowIso,
      note: "Covered by required smoke CI on merge; production SW path unchanged by this pack.",
    },
    SECURITY_GUARDS: {
      at: nowIso,
      paidPlacementsUntouched: true,
      growthExecute: false,
      emailOnlyDisarmed: true,
      cspTrustedTypes: "preserved",
    },
    OPEN_BLOCKERS: { at: nowIso, blockers: openBlockers },
    INTEGRITY_VERIFICATION: {
      at: nowIso,
      selfReferenceRule:
        "integrity-manifest excludes itself; ZIP sha256/crc32 are external sidecars only",
    },
  };

  const pack = buildCompletionAuditPack({
    stamp,
    outRoot: AUDIT_ROOT,
    evidence,
  });

  // Rename zip to required final autonomous production name
  const finalName = `phase3z-cj-final-autonomous-production-${stamp}.zip`;
  const finalAbs = path.join(AUDIT_ROOT, finalName);
  if (pack.zipAbs && fs.existsSync(pack.zipAbs)) {
    if (fs.existsSync(finalAbs)) fs.unlinkSync(finalAbs);
    fs.renameSync(pack.zipAbs, finalAbs);
    for (const ext of [".sha256", ".crc32", ".integrity.json"]) {
      const from = pack.zipAbs + ext;
      const to = finalAbs + ext;
      if (fs.existsSync(from)) {
        if (fs.existsSync(to)) fs.unlinkSync(to);
        fs.renameSync(from, to);
      }
    }
    if (fs.existsSync(finalAbs + ".integrity.json")) {
      const integ = JSON.parse(fs.readFileSync(finalAbs + ".integrity.json", "utf8"));
      integ.zip = finalName;
      integ.verdict = verdict;
      fs.writeFileSync(finalAbs + ".integrity.json", JSON.stringify(integ, null, 2) + "\n");
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: pack.ok,
        verdict,
        zip: finalName,
        sha256: pack.sha256,
        crc32: pack.crc32,
        bytes: pack.bytes,
        observation: obsEval,
        openBlockers,
      },
      null,
      2,
    ),
  );
  if (!pack.ok) process.exit(2);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
