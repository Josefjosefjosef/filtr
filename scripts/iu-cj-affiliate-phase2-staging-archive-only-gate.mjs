/** Re-export worker gate for offline parity (scripts CI). */
import {
  buildStagingCjApiReadiness,
  hasCjPatSecret,
  redactCjAuditFields,
  resolveStagingCjArchiveGate,
  trimPat,
  validateCjPublisherIdentityFields,
} from "../cloudflare/cj-email-ingest-d1-worker/src/staging-cj-api-archive-gate.mjs";

export {
  buildStagingCjApiReadiness,
  hasCjPatSecret,
  redactCjAuditFields,
  resolveStagingCjArchiveGate,
  trimPat,
  validateCjPublisherIdentityFields,
};

export function canExecuteStagingCjHttpRequest(env = process.env) {
  const gate = resolveStagingCjArchiveGate(env);
  if (!gate.mayExecuteHttp) {
    return { allowed: false, reason: gate.blockReason, gate };
  }
  return { allowed: true, reason: null, gate };
}
