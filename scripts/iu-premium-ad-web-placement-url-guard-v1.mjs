/**
 * Guard: premium ad web placement URLs must use iu_window=tool for all affiliate sections.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const placementSrc = fs.readFileSync(path.join(root, "cloudflare", "iu-ads", "src", "premium-ad-web-placement.ts"), "utf8");
const selectedSrc = fs.readFileSync(path.join(root, "cloudflare", "iu-ads", "src", "premium-selected-services.ts"), "utf8");
const testSrc = fs.readFileSync(
  path.join(root, "cloudflare", "iu-ads", "test", "premium-ad-web-placement.test.ts"),
  "utf8"
);

const slugMatch = selectedSrc.match(/export const PREMIUM_AFFILIATE_CATEGORY_SLUGS[^[]*\[([\s\S]*?)\];/);
const slugs = slugMatch ? [...slugMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];

const checks = [
  ["BUILD_SETS_IU_WINDOW", placementSrc.includes('url.searchParams.set(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM, PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE)')],
  ["NORMALIZE_LEGACY_SNAPSHOTS", placementSrc.includes("normalizePremiumAdWebPlacementUrl")],
  ["RESOLVE_REBUILDS_BROKEN_SNAPSHOT", placementSrc.includes("isFunctionalPremiumAdWebPlacementUrl")],
  ["VITEST_COVERAGE", testSrc.includes("tool-window section URL") && testSrc.includes("normalizePremiumAdWebPlacementUrl")],
  ["AFFILIATE_SLUG_COUNT_OK", slugs.length >= 35],
  [
    "INVOICE_PASSES_PLACEMENT_URL",
    fs.readFileSync(path.join(root, "cloudflare", "iu-ads", "src", "premium-order-documents.ts"), "utf8").includes(
      "ad_web_placement_url: ctx.ad_web_placement_url"
    ),
  ],
  [
    "CANCELLATION_USES_RESOLVE",
    fs.readFileSync(path.join(root, "cloudflare", "iu-ads", "src", "premium-order-cancellation-pdf.ts"), "utf8").includes(
      "premiumOrderAdWebPlacementForPdf"
    ),
  ],
];

let fail = 0;
for (const [key, ok] of checks) {
  process.stdout.write(key + "=" + (ok ? "true" : "false") + "\n");
  if (!ok) fail = 1;
}
process.stdout.write("AFFILIATE_SLUG_COUNT=" + String(slugs.length) + "\n");
process.exit(fail);
