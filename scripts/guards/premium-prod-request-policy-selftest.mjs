#!/usr/bin/env node
/**
 * Self-test: prod request budget + quota fail-fast helpers (no network).
 */
import {
  createProdRequestBudget,
  isCloudflareQuotaResponse,
} from "./prod-request-budget.mjs";

const fails = [];
function ok(id, cond) {
  if (!cond) fails.push(id);
}

const budget = createProdRequestBudget(3, "selftest");
budget.record("a");
budget.record("b");
budget.record("c");
let threw = false;
try {
  budget.record("d");
} catch (e) {
  threw = e && e.code === "PRODUCTION_REQUEST_BUDGET_EXCEEDED";
}
ok("budget_exceeded", threw);
ok("budget_count", budget.count === 4);

ok("quota_429", isCloudflareQuotaResponse(429, ""));
ok("quota_1027", isCloudflareQuotaResponse(200, "Error 1027 owner has reached their plan limits"));
ok("quota_ok", !isCloudflareQuotaResponse(200, "ok"));

if (fails.length) {
  console.error("FAIL premium-prod-request-policy-selftest");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS premium-prod-request-policy-selftest");
console.log("HTTP_429_FAIL_FAST=PASS");
console.log("ERROR_1027_FAIL_FAST=PASS");
console.log("PROD_REQUEST_BUDGET_GUARD=PASS");
