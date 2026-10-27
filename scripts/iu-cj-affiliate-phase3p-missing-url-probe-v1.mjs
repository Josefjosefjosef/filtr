#!/usr/bin/env node
/**
 * Phase 3P — Moje / Novakid / GearUP URL probe against staging links (DISARMED).
 * Never invents click URLs. Distinguishes coupon-only emptiness vs all-types emptiness.
 */
import fs from "node:fs";
import path from "node:path";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { resolveAdvertiserTrustedUrl } from "./iu-cj-affiliate-phase3o-baked-cid-resolve-v1.mjs";

const TARGETS = [
  {
    key: "mojeLekarna",
    advertiserId: "6466592",
    suggestedSection: "aff-lekarny",
    titleHints: ["Mojelekarna", "Moje lékárna"],
  },
  {
    key: "novakid",
    advertiserId: "5578976",
    suggestedSection: null,
    titleHints: ["Novakid"],
  },
  {
    key: "gearup",
    advertiserId: "7804601",
    suggestedSection: null,
    titleHints: ["GearUP"],
  },
];

const stagingPath =
  process.env.IU_CJ_PHASE3O_STAGING_JSON ||
  path.join(process.env.TEMP || "/tmp", "iu-phase3o-artifact", "iu-affiliate-cj-staging-v1.json");

const out = {
  schema: "iu-cj-affiliate-phase3p-missing-url-probe-v1",
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  stagingSource: fs.existsSync(stagingPath) ? stagingPath : "ABSENT",
  note:
    "Prior fetch used promotion-type=coupon only. Phase 3P adds Text Link + optional targeted advertiser probe. Re-run live fetch to refresh evidence.",
  fetchMechanismsApproved: [
    "CJ Advertiser Lookup (joined)",
    "CJ Link Search promotion-type=coupon",
    "CJ Link Search link-type=Text Link (phase3p)",
    "CJ Link Search advertiser-ids=<CID list> all types (phase3p probe)",
  ],
  forbidden: [
    "Synthesize click-<pid>-<cid>",
    "Use programUrl / storefront URL as affiliate click",
    "Guess tracking parameters",
  ],
  targets: {},
};

if (!fs.existsSync(stagingPath)) {
  out.status = "BLOCKED";
  out.reason = "staging_json_absent";
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const staging = JSON.parse(fs.readFileSync(stagingPath, "utf8"));
const advertisers = staging.advertisers || [];
const links = staging.links || [];

for (const t of TARGETS) {
  const resolved = resolveAdvertiserTrustedUrl({
    advertiserId: t.advertiserId,
    advertisers,
    links,
    suggestedSection: t.suggestedSection,
    titleHints: t.titleHints,
  });
  const advLinks = links.filter((L) => String(L.advertiserId) === t.advertiserId);
  const coupons = advLinks.filter((L) => /coupon/i.test(String(L.promotionType || L.linkType || "")));
  const textLinks = advLinks.filter((L) => /text\s*link/i.test(String(L.linkType || "")));
  const trusted = advLinks.filter((L) => isCjTrackingUrl(L.clickUrl || L.url || ""));

  out.targets[t.key] = {
    ...resolved,
    linkBreakdown: {
      total: advLinks.length,
      coupons: coupons.length,
      textLinks: textLinks.length,
      trustedClickUrls: trusted.length,
    },
    blocker:
      resolved.status === "READY_FOR_MANAGED_ADD"
        ? null
        : resolved.reason ||
          (advLinks.length === 0
            ? "NO_LINKS_IN_CURRENT_STAGING_FOR_ADVERTISER"
            : "NO_TRUSTED_CLICK_URL_IN_STAGING"),
    nextFetch:
      advLinks.length === 0
        ? "Re-run live catalog sync after Text Link + probe fetch (IU_CJ_SYNC_PROBE_ADVERTISER_IDS)"
        : null,
  };
}

out.status = "OK";
console.log(JSON.stringify(out, null, 2));
process.exit(0);
