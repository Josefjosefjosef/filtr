export function reevalProductStatusRow(p) {
  const variant = String((p && p.productVariant) || "").trim();
  return {
    productId: p && p.productId != null ? p.productId : null,
    ...(variant ? { productVariant: variant } : {}),
    eligibility: p ? p.eligibility : undefined,
    reason: p ? p.eligibilityReason : undefined,
  };
}

export function reevalProductIdRef(p) {
  const row = reevalProductStatusRow(p);
  const id = row.productId != null ? String(row.productId) : "";
  return row.productVariant ? id + "|" + row.productVariant : id;
}
