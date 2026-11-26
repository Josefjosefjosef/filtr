#!/usr/bin/env node
/**
 * V51.8 — coupons / actions validity audit (pure, no I/O).
 *
 * Classifies each coupon/action as ACTIVE | EXPIRED | UNKNOWN_VALIDITY
 * using validTo / validFrom when present.
 *
 * CLI selftest:
 *   node scripts/iu-cj-affiliate-phase3z-coupons-actions-audit-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const COUPONS_ACTIONS_AUDIT_SCHEMA =
  "iu-cj-affiliate-phase3z-coupons-actions-audit-v51-8";

export const VALIDITY = Object.freeze({
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  NOT_YET_ACTIVE: "NOT_YET_ACTIVE",
  UNKNOWN_VALIDITY: "UNKNOWN_VALIDITY",
});

function parseInstant(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const normalized = /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) ? s : s.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Classify a single offer row.
 * @param {{ validFrom?: string|null, validTo?: string|null }} item
 * @param {number} nowMs
 * @returns {"ACTIVE"|"EXPIRED"|"NOT_YET_ACTIVE"|"UNKNOWN_VALIDITY"}
 */
export function classifyOfferValidity(item, nowMs) {
  const fromMs = parseInstant(item?.validFrom);
  const toMs = parseInstant(item?.validTo);

  if (fromMs == null && toMs == null) return VALIDITY.UNKNOWN_VALIDITY;

  if (toMs != null && nowMs >= toMs) return VALIDITY.EXPIRED;
  if (fromMs != null && nowMs < fromMs) return VALIDITY.NOT_YET_ACTIVE;

  return VALIDITY.ACTIVE;
}

function auditList(rows, kind, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row, index) => {
    const validityStatus = classifyOfferValidity(row || {}, nowMs);
    return {
      kind,
      index,
      id: row?.id ?? row?.offerId ?? row?.code ?? null,
      title: row?.title ?? null,
      validFrom: row?.validFrom ?? null,
      validTo: row?.validTo ?? null,
      validityStatus,
    };
  });
}

/**
 * Build coupons/actions validity audit snapshot.
 * @param {{ coupons?: object[], actions?: object[], nowIso?: string }} input
 */
export function buildCouponsActionsAudit({ coupons, actions, nowIso } = {}) {
  const nowMs = nowIso != null ? Date.parse(String(nowIso)) : Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error("coupons-actions-audit: invalid nowIso: " + nowIso);
  }

  const couponRows = auditList(coupons, "coupon", nowMs);
  const actionRows = auditList(actions, "action", nowMs);
  const all = couponRows.concat(actionRows);

  const counts = {
    ACTIVE: 0,
    EXPIRED: 0,
    NOT_YET_ACTIVE: 0,
    UNKNOWN_VALIDITY: 0,
    coupons: couponRows.length,
    actions: actionRows.length,
    total: all.length,
  };
  for (const row of all) {
    counts[row.validityStatus] += 1;
  }

  return {
    schema: COUPONS_ACTIONS_AUDIT_SCHEMA,
    nowIso: new Date(nowMs).toISOString(),
    counts,
    coupons: couponRows,
    actions: actionRows,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

export function runCouponsActionsAuditSelftest() {
  const nowIso = "2026-06-15T12:00:00.000Z";
  const audit = buildCouponsActionsAudit({
    nowIso,
    coupons: [
      { id: "c-expired", title: "Old coupon", validFrom: "2025-01-01T00:00:00Z", validTo: "2025-12-31T23:59:59Z" },
      { id: "c-active", title: "Live coupon", validFrom: "2026-01-01T00:00:00Z", validTo: "2026-12-31T23:59:59Z" },
      { id: "c-unknown", title: "No dates" },
    ],
    actions: [
      { id: "a-expired", title: "Old action", validTo: "2024-06-01T00:00:00Z" },
      { id: "a-active", title: "Live action", validFrom: "2026-01-01T00:00:00Z", validTo: "2027-01-01T00:00:00Z" },
      { id: "a-unknown", title: "Missing validity" },
    ],
  });

  const cExpired = audit.coupons.find((c) => c.id === "c-expired");
  const cActive = audit.coupons.find((c) => c.id === "c-active");
  const cUnknown = audit.coupons.find((c) => c.id === "c-unknown");
  const aExpired = audit.actions.find((a) => a.id === "a-expired");
  const aActive = audit.actions.find((a) => a.id === "a-active");
  const aUnknown = audit.actions.find((a) => a.id === "a-unknown");

  assert(cExpired?.validityStatus === VALIDITY.EXPIRED, "expired coupon");
  assert(cActive?.validityStatus === VALIDITY.ACTIVE, "active coupon");
  assert(cUnknown?.validityStatus === VALIDITY.UNKNOWN_VALIDITY, "unknown coupon");
  assert(aExpired?.validityStatus === VALIDITY.EXPIRED, "expired action");
  assert(aActive?.validityStatus === VALIDITY.ACTIVE, "active action");
  assert(aUnknown?.validityStatus === VALIDITY.UNKNOWN_VALIDITY, "unknown action");
  assert(audit.counts.EXPIRED === 2, "expired count");
  assert(audit.counts.ACTIVE === 2, "active count");
  assert(audit.counts.UNKNOWN_VALIDITY === 2, "unknown count");
  const future = classifyOfferValidity(
    { validFrom: "2026-07-01T00:00:00.000Z", validTo: "2026-07-31T00:00:00.000Z" },
    Date.parse(nowIso),
  );
  assert(future === VALIDITY.NOT_YET_ACTIVE, "future start is not expired");

  return {
    schema: COUPONS_ACTIONS_AUDIT_SCHEMA + "-selftest",
    ok: true,
    nowIso: audit.nowIso,
    counts: audit.counts,
    sample: {
      couponExpired: cExpired.validityStatus,
      couponActive: cActive.validityStatus,
      actionExpired: aExpired.validityStatus,
      actionActive: aActive.validityStatus,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runCouponsActionsAuditSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_COUPONS_ACTIONS_AUDIT_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
