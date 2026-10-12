/**
 * CI guard: pre-launch bulk premium operational reset (main admin, repeatable, commercial block).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adsSrc = path.join(root, "cloudflare", "iu-ads", "src");
const adsTest = path.join(root, "cloudflare", "iu-ads", "test");
const wrangler = fs.readFileSync(path.join(root, "cloudflare", "iu-ads", "wrangler.toml"), "utf8");

function readSrc(name) {
  return fs.readFileSync(path.join(adsSrc, name), "utf8");
}

const reset = readSrc("premium-order-test-data-reset.ts");
const purge = readSrc("premium-order-purge.ts");
const guard = readSrc("premium-dev-operational-reset-guard.ts");
const integration = fs.readFileSync(
  path.join(adsTest, "premium-order-test-data-reset.integration.test.ts"),
  "utf8"
);

const checks = [
  ["RESET_GUARD_MODULE", fs.existsSync(path.join(adsSrc, "premium-dev-operational-reset-guard.ts"))],
  ["RESET_COMMERCIAL_LIVE_BLOCK", guard.includes("PREMIUM_COMMERCIAL_LIVE") && reset.includes("isPremiumDevOperationalResetEnabled")],
  ["RESET_NO_SKIP_PAID_IN_BULK", !reset.includes("premiumOrderHasPaidAccountingEvidence")],
  ["RESET_TERMS_BINDINGS_PURGE", purge.includes("premium_order_terms_bindings")],
  ["RESET_PREVIEW_ROUTE", readSrc("index.ts").includes("/v1/admin/premium/test-data/reset/preview")],
  ["RESET_WRANGLER_DEV_FLAG", wrangler.includes("PREMIUM_DEV_OPERATIONAL_RESET_ENABLED")],
  ["RESET_INTEGRATION_PAID", integration.includes("reset removes paid premium orders")],
  ["RESET_INTEGRATION_IDEMPOTENT", integration.includes("reset is idempotent")],
  ["RESET_INTEGRATION_TERMS_FK", integration.includes("premium_order_terms_bindings")],
  ["RESET_INTEGRATION_CYCLE", integration.includes("dev reset cycle")],
  ["RESET_HISTORY_LABELS_TEST", fs.existsSync(path.join(adsTest, "premium-order-history-labels.test.ts"))],
  ["RESET_PDF_HEADER_GAP", readSrc("premium-invoice-pdf-layout.ts").includes("PREMIUM_PDF_HEADER_BODY_GAP_PT")],
];

let fail = 0;
for (const [key, ok] of checks) {
  process.stdout.write(key + "=" + (ok ? "true" : "false") + "\n");
  if (!ok) fail++;
}
process.stdout.write("DEV_RESET_GUARD_PASS=" + (fail === 0 ? "true" : "false") + "\n");
process.exit(fail === 0 ? 0 : 1);
