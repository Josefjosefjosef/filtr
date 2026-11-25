#!/usr/bin/env node
/**
 * G-PARTNER-LIFECYCLE — explicit PASS selftest path for partner-lifecycle-audit (offline, pure).
 * Covers: JOINED discovery→inventory→publish path, ENDED never from CJ_API_DOWN, paid/protected slots preserved.
 */
import { runPartnerLifecycleAuditSelftest } from "./iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8.mjs";
import { runPartnerLifecycleScenarios } from "./iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs";

const audit = runPartnerLifecycleAuditSelftest();
const scenarios = runPartnerLifecycleScenarios();
const ok = audit.ok === true && scenarios.ok === true;

console.log(
  JSON.stringify({
    IU_CJ_PARTNER_LIFECYCLE_AUDIT_SELFTEST: ok ? "PASS" : "FAIL",
    auditChecks: audit.checks.length,
    auditFailed: audit.failed,
    lifecycleScenarios: scenarios.scenarios.length,
    lifecycleFailed: scenarios.failed ?? [],
  }),
);
if (!ok) process.exit(1);
