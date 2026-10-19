/** Production key material + verify-only boundary (v21 — no signing exports). */
import { createHmac, timingSafeEqual } from "node:crypto";

export const OFFLINE_PRODUCTION_SEAL_SIMULATION_MARKER = "not_real_production";

let productionSealKeyMaterial = null;
let productionTrustContextLocked = false;

function computeProductionHmacHexInternal(sealInputUtf8) {
  if (!productionSealKeyMaterial) return null;
  return createHmac("sha256", productionSealKeyMaterial).update(sealInputUtf8, "utf8").digest("hex");
}

function assignProductionKeyInternal(sealKeyMaterial) {
  if (productionTrustContextLocked) {
    if (productionSealKeyMaterial === sealKeyMaterial) {
      return { ok: true, profile: "production_worker_v1", idempotent: true };
    }
    return { ok: false, reason: "production_trust_context_locked" };
  }
  if (productionSealKeyMaterial !== null && productionSealKeyMaterial !== sealKeyMaterial) {
    return { ok: false, reason: "production_seal_key_immutable_after_configuration" };
  }
  const idempotent = productionSealKeyMaterial === sealKeyMaterial;
  productionSealKeyMaterial = sealKeyMaterial;
  return { ok: true, profile: "production_worker_v1", idempotent };
}

export function vaultIsProductionKeyConfigured() {
  return productionSealKeyMaterial != null;
}

export function vaultIsProductionTrustContextLocked() {
  return productionTrustContextLocked;
}

/** Key configure for lock/idempotence tests — does not enable offline production signing. */
export function vaultConfigureProductionKeyMaterial(sealKeyMaterial) {
  return assignProductionKeyInternal(sealKeyMaterial);
}

/** Offline harness bridge only — not imported by production lib. */
export function vaultHarnessTryAssignProductionKey(sealKeyMaterial) {
  return assignProductionKeyInternal(sealKeyMaterial);
}

/** Offline harness reset only — refused when locked. */
export function vaultHarnessResetProductionKeyState() {
  if (productionTrustContextLocked) {
    return { ok: false, reason: "production_trust_context_locked" };
  }
  productionSealKeyMaterial = null;
  productionTrustContextLocked = false;
  return { ok: true };
}

export function vaultActivateProductionTrustContext() {
  if (!productionSealKeyMaterial) {
    return { ok: false, reason: "production_dedup_seal_key_missing" };
  }
  if (productionTrustContextLocked) {
    return { ok: true, alreadyActive: true, locked: true };
  }
  productionTrustContextLocked = true;
  return { ok: true, locked: true };
}

/** Verify-only (no grant/sign exports in v21). */
export function vaultVerifyProductionHmacHex(sealInputUtf8, sealHex) {
  if (!productionSealKeyMaterial || typeof sealHex !== "string" || sealHex.length === 0) {
    return { ok: false, reason: "seal_verifier_not_configured" };
  }
  const expected = computeProductionHmacHexInternal(sealInputUtf8);
  if (!expected) return { ok: false, reason: "seal_verifier_not_configured" };
  if (expected.length !== sealHex.length) {
    return { ok: false, reason: "identity_seal_mismatch" };
  }
  try {
    if (!timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sealHex, "utf8"))) {
      return { ok: false, reason: "identity_seal_mismatch" };
    }
  } catch {
    return { ok: false, reason: "identity_seal_mismatch" };
  }
  return { ok: true };
}
