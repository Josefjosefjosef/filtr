import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const resetPath = path.join(root, "cloudflare", "iu-ads", "src", "premium-order-test-data-reset.ts");
const purgePath = path.join(root, "cloudflare", "iu-ads", "src", "premium-order-purge.ts");
const indexPath = path.join(root, "cloudflare", "iu-ads", "src", "index.ts");
const uiPath = path.join(root, "cloudflare", "iu-ads", "src", "admin-ui-script.ts");

const resetSrc = fs.readFileSync(resetPath, "utf8");
const purgeSrc = fs.readFileSync(purgePath, "utf8");
const indexSrc = fs.readFileSync(indexPath, "utf8");
const uiSrc = fs.readFileSync(uiPath, "utf8");

const needles = [
  ["purge", "premium_order_terms_bindings"],
  ["purge", "order_terms_bindings"],
  ["reset", "premium_order_terms_bindings"],
  ["reset", "buildPremiumTestDataResetPreview"],
  ["reset", "nothing_to_remove"],
  ["reset", "PREMIUM_TEST_DATA_RESET_LOCK"],
  ["purge", "premiumOrderEligibleForBulkTestReset"],
  ["index", "/v1/admin/premium/test-data/reset/preview"],
  ["ui", "/v1/admin/premium/test-data/reset/preview"],
  ["ui", "eligible_orders"],
];

for (const [file, needle] of needles) {
  const src =
    file === "purge" ? purgeSrc : file === "reset" ? resetSrc : file === "index" ? indexSrc : uiSrc;
  if (!src.includes(needle)) {
    console.error("FAIL: missing " + needle + " in " + file);
    process.exit(1);
  }
}

console.log("PASS: iu-premium-test-data-reset-guard-v1");
