#!/usr/bin/env node
/** One diagnostic row for an eligible product. Does not publish. */
export function landingBatchDiagnosticRow(binding, product) {
  const row = product || {};
  const verify = row.landingBatchVerify;
  const variant = String(row.productVariant || "").trim();
  return {
    linkId: binding?.linkId ?? null,
    productId: row.productId != null ? String(row.productId) : null,
    ...(variant ? { productVariant: variant } : {}),
    landingBatchReason: verify?.reason || row.landingIdentity?.reason || null,
    linkageLayer: verify?.linkageLayer || null,
    productIdentityLinkage: verify?.productIdentityLinkage || null,
    offerActionLinkage: verify?.offerActionLinkage || null,
    diagnostics: verify?.diagnostics || null,
    landingSource: row.landingSource || null,
  };
}
