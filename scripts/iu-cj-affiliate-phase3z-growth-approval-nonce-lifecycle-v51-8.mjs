/**
 * Growth approval nonce lifecycle — allowed transitions (shared rules).
 * Terminal states never re-arm. Recovery = new owner approval (new nonce).
 */
import crypto from "node:crypto";

export const NONCE_STATES = Object.freeze([
  "RESERVED",
  "ARMED",
  "COMPLETED",
  "FAILED",
  "STOPPED",
  "EXPIRED",
  "REVOKED",
]);

export const TERMINAL_NONCE_STATES = Object.freeze([
  "COMPLETED",
  "FAILED",
  "STOPPED",
  "EXPIRED",
  "REVOKED",
]);

/** from → allowed next */
export const ALLOWED_NONCE_TRANSITIONS = Object.freeze({
  RESERVED: Object.freeze(["ARMED", "FAILED", "STOPPED", "EXPIRED", "REVOKED"]),
  ARMED: Object.freeze(["COMPLETED", "FAILED", "STOPPED", "EXPIRED", "REVOKED"]),
  COMPLETED: Object.freeze([]),
  FAILED: Object.freeze([]),
  STOPPED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
  REVOKED: Object.freeze([]),
});

export function isTerminalNonceState(state) {
  return TERMINAL_NONCE_STATES.includes(String(state || "").toUpperCase());
}

export function canTransitionNonceState(from, to) {
  const f = String(from || "").toUpperCase();
  const t = String(to || "").toUpperCase();
  const allowed = ALLOWED_NONCE_TRANSITIONS[f];
  if (!allowed) return false;
  return allowed.includes(t);
}

export function evaluateNonceTransition(opts = {}) {
  const from = String(opts.from || "").toUpperCase();
  const to = String(opts.to || "").toUpperCase();
  if (!NONCE_STATES.includes(to)) {
    return { ok: false, reason: "NONCE_STATE_INVALID", from, to };
  }
  if (!NONCE_STATES.includes(from)) {
    return { ok: false, reason: "NONCE_STATE_INVALID", from, to };
  }
  if (isTerminalNonceState(from)) {
    return { ok: false, reason: "NONCE_STATE_TERMINAL", from, to };
  }
  if (!canTransitionNonceState(from, to)) {
    return { ok: false, reason: "NONCE_TRANSITION_DENIED", from, to };
  }
  return { ok: true, reason: "OK", from, to };
}

/**
 * COMPLETED requires verified publication evidence — never arming alone.
 */
export function evaluateCompletedPublicationEvidence(opts = {}) {
  const fails = [];
  const reservationKey = String(opts.reservationKey || "").trim();
  const operationId = String(opts.operationId || "").trim();
  const expectedOperationId = String(opts.expectedOperationId || opts.operationId || "").trim();
  const mainSha = String(opts.mainSha || "").trim().toLowerCase();
  const expectedMainSha = String(opts.expectedMainSha || "").trim().toLowerCase();
  const generationId = String(opts.generationId || "").trim();
  const expectedGenerationId = String(opts.expectedGenerationId || "").trim();
  const prodGenerationId = String(opts.productionGenerationId || "").trim();
  const contentSha = String(opts.contentSha || "").trim().toLowerCase();
  const expectedContentSha = String(opts.expectedContentSha || "").trim().toLowerCase();

  if (!reservationKey) fails.push("missing_reservationKey");
  if (!operationId) fails.push("missing_operationId");
  if (expectedOperationId && operationId !== expectedOperationId) fails.push("operationId_mismatch");
  if (!/^[0-9a-f]{40}$/i.test(mainSha)) fails.push("missing_mainSha");
  if (expectedMainSha && mainSha !== expectedMainSha) fails.push("mainSha_mismatch");
  if (!generationId) fails.push("missing_generationId");
  if (expectedGenerationId && generationId !== expectedGenerationId) fails.push("generationId_mismatch");
  if (opts.requiredCiPass !== true) fails.push("required_ci_not_pass");
  if (opts.dataPrMerged !== true) fails.push("data_pr_not_merged");
  if (opts.pagesDeployPass !== true) fails.push("pages_deploy_not_verified");
  if (!prodGenerationId) fails.push("production_generation_missing");
  if (prodGenerationId && generationId && prodGenerationId !== generationId) {
    fails.push("production_generation_mismatch");
  }
  if (!contentSha || !/^[0-9a-f]{16,64}$/i.test(contentSha)) fails.push("content_sha_missing");
  if (expectedContentSha && contentSha !== expectedContentSha) fails.push("content_sha_mismatch");
  if (opts.publishedProductsVerified !== true) fails.push("published_products_not_verified");

  if (fails.length) {
    return {
      ok: false,
      reason: "COMPLETED_EVIDENCE_INSUFFICIENT",
      fails,
      allowCompleted: false,
    };
  }
  return { ok: true, reason: "COMPLETED_EVIDENCE_OK", fails: [], allowCompleted: true };
}

export function buildGrowthOperationId(parts = {}) {
  const material = [
    String(parts.reservationKey || "").trim(),
    String(parts.mainSha || "").trim().toLowerCase(),
    String(parts.generationId || "").trim(),
    String(parts.runId || "").trim(),
  ].join("|");
  return crypto.createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}
