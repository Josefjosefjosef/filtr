#!/usr/bin/env node
/**
 * Bounded production smoke: one Premium category catalog+render on ads.infouzel.cz.
 * Run only after cheap health probe returns HTTP 200 (no quota).
 */
import {
  createProdRequestBudget,
  isCloudflareQuotaResponse,
  quotaBlockerFailMessage,
} from "./guards/prod-request-budget.mjs";

/** Root routing prod guard (earlier in smoke) already probes infouzel.cz — ads Worker budget is catalog+render only. */
const PROD_SMOKE_REQUEST_BUDGET = 2;
const SAMPLE_CATEGORY = "aff-auto-moto";
const API = "https://ads.infouzel.cz/v1/public/premium/selected-services";

const budget = createProdRequestBudget(PROD_SMOKE_REQUEST_BUDGET, "iu-premium-selected-prod-smoke-bounded");

async function fetchBounded(url) {
  budget.record(url);
  const res = await fetch(url, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: AbortSignal.timeout(25000),
  });
  let text = "";
  try {
    text = await res.text();
  } catch (_) {
    text = "";
  }
  if (isCloudflareQuotaResponse(res.status, text)) {
    console.log(quotaBlockerFailMessage("premium_prod_smoke:" + res.status));
    console.log("CLOUDFLARE_QUOTA_BLOCKER=true");
    process.exit(2);
  }
  return { status: res.status, text };
}

async function main() {
  const catalog = await fetchBounded(API + "/catalog?category=" + encodeURIComponent(SAMPLE_CATEGORY));
  if (catalog.status !== 200) {
    console.log("FAIL catalog status=" + catalog.status);
    process.exit(1);
  }
  let catalogJson;
  try {
    catalogJson = JSON.parse(catalog.text);
  } catch (_) {
    console.log("FAIL catalog_invalid_json");
    process.exit(1);
  }
  if (!catalogJson || !Array.isArray(catalogJson.slots)) {
    console.log("FAIL catalog_missing_slots");
    process.exit(1);
  }

  const render = await fetchBounded(API + "/render?category=" + encodeURIComponent(SAMPLE_CATEGORY));
  if (render.status !== 200) {
    console.log("FAIL render status=" + render.status);
    process.exit(1);
  }

  console.log("PASS iu-premium-selected-prod-smoke-bounded");
  console.log("PROD_SMOKE_REQUEST_BUDGET=" + PROD_SMOKE_REQUEST_BUDGET);
  console.log("ACTUAL_PROD_REQUESTS=" + budget.count);
  console.log("PREMIUM_PRODUCTION_SMOKE=PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(2);
});
