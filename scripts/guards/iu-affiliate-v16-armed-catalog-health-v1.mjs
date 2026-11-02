#!/usr/bin/env node
/**
 * V17: when PUBLIC_SWAP is armed, historical slot-order freezes may soft-exit
 * ONLY after a real new-catalog health check (not a blind PASS).
 */
import fs from "node:fs";
import path from "node:path";
import { isCjTrackingUrl } from "../iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

/**
 * @param {string} ROOT
 * @param {{ guardName?: string }} [opts]
 * @returns {{ armed: boolean, ok: boolean, report: object }}
 */
export function evaluateArmedCatalogHealth(ROOT, opts = {}) {
  const catalogPath = path.join(ROOT, "assets", "iu-affiliate-catalog.js");
  const staticPath = path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json");
  const catalog = fs.readFileSync(catalogPath, "utf8");
  const armed = /IU_AFF_PUBLIC_SWAP_ARMED\s*=\s*true/.test(catalog);
  if (!armed) {
    return { armed: false, ok: false, report: { reason: "not_armed" } };
  }

  const fails = [];
  const partnerRe =
    /affPartner\(\s*"([^"]+)"\s*,\s*"(https:[^"]+)"\s*(?:,\s*"(\d+)")?\s*\)/g;
  const partners = [];
  let m;
  while ((m = partnerRe.exec(catalog))) {
    partners.push({ title: m[1], href: m[2], advertiserId: m[3] || null });
  }

  if (partners.length < 1) fails.push("no_affPartner_rows");

  let nonCj = 0;
  let missingId = 0;
  const ids = new Set();
  let dupIds = 0;
  const hosts = {};
  for (const p of partners) {
    if (!isCjTrackingUrl(p.href)) nonCj += 1;
    if (!p.advertiserId) missingId += 1;
    else if (ids.has(p.advertiserId)) dupIds += 1;
    else ids.add(p.advertiserId);
    try {
      const h = new URL(p.href).hostname.toLowerCase();
      hosts[h] = (hosts[h] || 0) + 1;
    } catch (_) {}
  }
  if (nonCj) fails.push("non_cj_urls:" + nonCj);
  if (missingId) fails.push("missing_advertiser_id:" + missingId);
  if (dupIds) fails.push("duplicate_advertiser_ids:" + dupIds);

  // Broken .com-only classifier must NOT be used — .net hosts are valid CJ.
  const netHosts = Object.keys(hosts).filter((h) => h.endsWith(".net"));
  if (netHosts.length < 1) fails.push("expected_cj_net_hosts_missing");

  let staticOk = false;
  let paragonBlocked = false;
  let staticButtons = null;
  let joined = null;
  if (fs.existsSync(staticPath)) {
    const staticCat = JSON.parse(fs.readFileSync(staticPath, "utf8"));
    staticOk = staticCat.publicButtonSwapArmed === true && staticCat.liveEnabled === true;
    staticButtons = staticCat.counts && staticCat.counts.buttons;
    joined = staticCat.counts && staticCat.counts.joined;
    paragonBlocked = (staticCat.remainingBlockers || []).some(
      (b) => String(b.advertiserId) === "4686326"
    );
    if (!staticOk) fails.push("static_json_not_armed");
    if (staticButtons != null && staticButtons !== partners.length) {
      fails.push("static_buttons_mismatch:" + staticButtons + "!=" + partners.length);
    }
    if (!paragonBlocked) fails.push("paragon_not_in_remainingBlockers");
  } else {
    fails.push("static_json_missing");
  }

  if (!/function applyStaticMainCatalogV13/.test(catalog)) fails.push("missing_static_loader");
  if (!/rel="sponsored noopener"/.test(catalog)) fails.push("missing_sponsored_noopener");
  if (/affPartner\([^)]*4686326/.test(catalog)) fails.push("paragon_published_as_button");

  const report = {
    guard: opts.guardName || null,
    armed: true,
    partners: partners.length,
    uniqueAdvertiserIds: ids.size,
    nonCj,
    dupIds,
    hosts,
    netHostCount: netHosts.length,
    staticButtons,
    joined,
    paragonBlocked,
    fails,
  };
  return { armed: true, ok: fails.length === 0, report };
}

/**
 * If armed + healthy: print PASS JSON and return true (caller should exit 0).
 * If armed + unhealthy: print FAIL and exit 1.
 * If not armed: return false (caller continues historical checks).
 */
export function exitIfArmedCatalogHealthy(ROOT, guardName) {
  const { armed, ok, report } = evaluateArmedCatalogHealth(ROOT, { guardName });
  if (!armed) return false;
  if (!ok) {
    console.log(
      JSON.stringify({
        [guardName || "IU_AFFILIATE_ARMED_CATALOG_HEALTH"]: "FAIL",
        skipped: false,
        reason: "armed_catalog_health_failed",
        report,
      })
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      [guardName || "IU_AFFILIATE_ARMED_CATALOG_HEALTH"]: "PASS",
      skipped: "historical_slot_freeze_superseded_after_armed_catalog_health",
      report: {
        partners: report.partners,
        uniqueAdvertiserIds: report.uniqueAdvertiserIds,
        paragonBlocked: report.paragonBlocked,
        netHostCount: report.netHostCount,
      },
    })
  );
  process.exit(0);
}
