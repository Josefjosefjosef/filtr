export function continuationEvidenceKey(row) {
  const variant = String((row && row.productVariant) || "").trim();
  const explicit = String((row && row.sourceIdentity) || "").trim();
  const advertiserId = String(row && row.advertiserId != null ? row.advertiserId : "");
  const productId = String(row && row.productId != null ? row.productId : "");
  const base = advertiserId + "|" + productId;
  const withVariant = variant ? base + "|" + variant : base;
  if (!explicit) return withVariant;
  if (variant && explicit !== withVariant && !explicit.endsWith("|" + variant)) return withVariant;
  return explicit;
}
