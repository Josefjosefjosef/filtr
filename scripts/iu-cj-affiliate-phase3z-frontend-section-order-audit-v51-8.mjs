#!/usr/bin/env node
/**
 * V51.8 — frontend section order audit (pure, no IO).
 *
 * expectedOrder = ['partner_buttons','coupons_promos','product_cards','legal_info']
 * auditSectionOrder(actualOrder) → PASS/FAIL + diffs
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-frontend-section-order-audit-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const FRONTEND_SECTION_ORDER_AUDIT_SCHEMA =
  "iu-cj-affiliate-phase3z-frontend-section-order-audit-v51-8";

export const expectedOrder = Object.freeze([
  "partner_buttons",
  "coupons_promos",
  "product_cards",
  "legal_info",
]);

function normalizeOrder(order) {
  if (!Array.isArray(order)) return [];
  return order.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/**
 * Compare actual section order against expectedOrder.
 * @param {string[]} actualOrder
 * @returns {{ ok: boolean, status: 'PASS'|'FAIL', expectedOrder: string[], actualOrder: string[], diffs: object[] }}
 */
export function auditSectionOrder(actualOrder) {
  const actual = normalizeOrder(actualOrder);
  const expected = [...expectedOrder];
  const diffs = [];

  const maxLen = Math.max(expected.length, actual.length);
  for (let i = 0; i < maxLen; i++) {
    const exp = expected[i] ?? null;
    const act = actual[i] ?? null;
    if (exp !== act) {
      diffs.push({
        index: i,
        expected: exp,
        actual: act,
        kind:
          exp == null
            ? "extra"
            : act == null
              ? "missing"
              : "mismatch",
      });
    }
  }

  // Also flag items present but out of relative order (even if length matches via swap)
  const expIndex = new Map(expected.map((s, i) => [s, i]));
  for (let i = 0; i < actual.length; i++) {
    const name = actual[i];
    if (!expIndex.has(name)) {
      const already = diffs.some((d) => d.actual === name && d.kind === "extra");
      if (!already) {
        diffs.push({
          index: i,
          expected: null,
          actual: name,
          kind: "unexpected",
        });
      }
    }
  }

  const ok = diffs.length === 0 && actual.length === expected.length;
  return {
    schema: FRONTEND_SECTION_ORDER_AUDIT_SCHEMA,
    ok,
    status: ok ? "PASS" : "FAIL",
    expectedOrder: expected,
    actualOrder: actual,
    diffs,
  };
}

/** Selftest: PASS on exact order; FAIL on swap. */
export function runFrontendSectionOrderAuditSelftest() {
  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: cond === true, detail: detail ?? null });
  }

  const exact = auditSectionOrder([...expectedOrder]);
  check("exact_pass_status", exact.status === "PASS" && exact.ok === true, exact);
  check("exact_no_diffs", exact.diffs.length === 0, exact.diffs);

  const swapped = [
    "partner_buttons",
    "product_cards",
    "coupons_promos",
    "legal_info",
  ];
  const swap = auditSectionOrder(swapped);
  check("swap_fail_status", swap.status === "FAIL" && swap.ok === false, swap);
  check("swap_has_diffs", swap.diffs.length >= 2, swap.diffs);
  check(
    "swap_mismatch_coupons",
    swap.diffs.some(
      (d) =>
        d.index === 1 &&
        d.expected === "coupons_promos" &&
        d.actual === "product_cards",
    ),
    swap.diffs,
  );
  check(
    "swap_mismatch_products",
    swap.diffs.some(
      (d) =>
        d.index === 2 &&
        d.expected === "product_cards" &&
        d.actual === "coupons_promos",
    ),
    swap.diffs,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: FRONTEND_SECTION_ORDER_AUDIT_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    exact,
    swap,
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runFrontendSectionOrderAuditSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_FRONTEND_SECTION_ORDER_AUDIT_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
