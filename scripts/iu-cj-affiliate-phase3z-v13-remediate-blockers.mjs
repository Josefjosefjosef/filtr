#!/usr/bin/env node
/**
 * Phase 3Z V13 — re-verify Cheapvuelos + Paragon against staging links.
 * Never fabricates CJ click URLs. Updates registry destination typing + MAIN_BUTTON_READY.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAllowedDataWrite, isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  classifyDestinationType,
  isUnsuitableMainDestination,
} from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { selectPrimaryAffiliateLink } from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";
import { attachMainButtonReadiness } from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";
import { buildDefaultMainButtonEmailHintMap } from "./iu-cj-affiliate-phase3z-main-button-email-hints-v12.mjs";
import { isHardUnsuitableMainButtonDestination } from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_IDS = ["7947783", "4686326"];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

export function remediatePartnerFromStaging(partner, advLinks, advertiser, websitePid) {
  const advId = String(partner.advertiserId);
  const scan = (advLinks || []).map((l) => {
    const dest = String(l.destination || "");
    const dtype = classifyDestinationType(dest, l.linkName || "");
    const uns = isUnsuitableMainDestination(dtype, advId);
    const hard = isHardUnsuitableMainButtonDestination({
      destinationType: dtype,
      selectedClickUrl: l.clickUrl || "",
      unsuitableMainDestination: uns.unsuitable,
    });
    return {
      linkId: l.linkId,
      linkName: l.linkName,
      linkType: l.linkType,
      destinationType: dtype,
      hardBlocked: hard.blocked,
      clickUrl: l.clickUrl,
      destination: dest,
    };
  });
  const ok = scan.filter((s) => !s.hardBlocked && isCjTrackingUrl(String(s.clickUrl || "")));
  const pick = selectPrimaryAffiliateLink(advLinks || [], advertiser || { advertiserId: advId }, {
    websitePid: websitePid || "101883843",
    advertiserId: advId,
    previousLinkId: partner.selectedLinkId || null,
  });

  const attempts = [
    {
      step: "cj_link_search_full_rescan_v13",
      linkCount: scan.length,
      okCandidateCount: ok.length,
      destinationTypes: [...new Set(scan.map((s) => s.destinationType))],
    },
  ];

  let updated = { ...partner };
  // Prefer selectPrimaryAffiliateLink when it yields a non-hard-blocked CJ click;
  // otherwise fall back to first scan-ok candidate (V13 classifier may unblock
  // promo landings that the older unsuitableMain flag still penalizes in ranking).
  const candidates = [];
  if (pick?.clickUrl && isCjTrackingUrl(pick.clickUrl)) {
    candidates.push({
      clickUrl: pick.clickUrl,
      linkId: pick.linkId || pick.selectedLinkId || null,
      linkName: pick.linkName || "",
      destination: pick.destination || pick.selectedDestination || "",
      via: "selectPrimaryAffiliateLink",
    });
  }
  for (const s of ok) {
    candidates.push({
      clickUrl: s.clickUrl,
      linkId: s.linkId,
      linkName: s.linkName || "",
      destination: s.destination || "",
      via: "scan_ok_candidate",
    });
  }
  for (const c of candidates) {
    const dtype = classifyDestinationType(String(c.destination || ""), c.linkName || "");
    const hard = isHardUnsuitableMainButtonDestination({
      destinationType: dtype,
      selectedClickUrl: c.clickUrl,
      unsuitableMainDestination: false,
    });
    if (hard.blocked) continue;
    updated.selectedClickUrl = c.clickUrl;
    updated.selectedLinkId = c.linkId || null;
    updated.destinationType = dtype;
    updated.unsuitableMainDestination = false;
    if (updated.holdReason === "UNSUITABLE_MAIN_DESTINATION") updated.holdReason = null;
    if (updated.publishability === "QUARANTINED") updated.publishability = "READY_FOR_REVIEW";
    attempts.push({
      step: "select_authorized_customer_link",
      result: "selected",
      via: c.via,
      linkId: updated.selectedLinkId,
      destinationType: dtype,
    });
    return {
      advertiserId: advId,
      resolved: true,
      partner: updated,
      attempts,
      nextFeasibleFix: null,
    };
  }

  attempts.push({
    step: "no_fabricated_tracking_url",
    result: "skipped_programurl_without_authorized_cj_click",
  });
  attempts.push({
    step: "schedule_auto_retry",
    result: "will_recheck_on_each_catalog_sync",
  });
  return {
    advertiserId: advId,
    resolved: false,
    partner: updated,
    attempts,
    nextFeasibleFix:
      "Obtain authorized CJ homepage/service deep-link via Link Search refresh or advertiser; do not invent click URL.",
    scanSummary: {
      linkCount: scan.length,
      okCandidateCount: ok.length,
      destinationTypes: [...new Set(scan.map((s) => s.destinationType))],
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  const regPath = path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json");
  const stagingPath = path.join(ROOT, "projects", "data", "iu-affiliate-cj-staging-v1.json");
  const registry = readJson(regPath);
  const staging = readJson(stagingPath);
  const advs = Object.fromEntries(
    (staging.advertisers || []).map((a) => [String(a.advertiserId), a])
  );
  const results = [];

  for (const id of TARGET_IDS) {
    const idx = (registry.partners || []).findIndex((p) => String(p.advertiserId) === id);
    if (idx < 0) {
      results.push({ advertiserId: id, resolved: false, error: "not_in_registry" });
      continue;
    }
    const links = (staging.links || []).filter((l) => String(l.advertiserId) === id);
    const rem = remediatePartnerFromStaging(
      registry.partners[idx],
      links,
      advs[id],
      staging.websitePid || "101883843"
    );
    registry.partners[idx] = rem.partner;
    results.push(rem);
  }

  attachMainButtonReadiness(registry, {
    emailHintsByAdvertiserId: buildDefaultMainButtonEmailHintMap(),
  });

  // Enrich remaining blockers with V13 remediation attempts
  for (const row of registry.mainButtonSummary?.remainingBlockers || []) {
    const hit = results.find((r) => String(r.advertiserId) === String(row.advertiserId));
    if (hit) {
      row.remediationAttempts = hit.attempts;
      row.nextFeasibleFix = hit.nextFeasibleFix;
      row.autoRetryOnCatalogSync = true;
    }
  }

  registry.publicButtonSwapArmed = false;
  registry.cjFirstMainButtonArchitecture = "IMPLEMENTED";
  registry.v13BlockerRemediation = {
    at: new Date().toISOString(),
    results: results.map((r) => ({
      advertiserId: r.advertiserId,
      resolved: r.resolved,
      attempts: r.attempts,
      nextFeasibleFix: r.nextFeasibleFix || null,
      scanSummary: r.scanSummary || null,
    })),
  };

  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(regPath);
    writeJson(regPath, registry);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: writeRepo,
        publicButtonSwapArmed: false,
        mainButtonSummary: registry.mainButtonSummary,
        remediation: registry.v13BlockerRemediation,
      },
      null,
      2
    )
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
