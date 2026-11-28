export function deployProofBucket(product) {
  if (product?.publicationReady !== true) return "skip";
  const held =
    product.lkgPublicHold === true ||
    product.publicOffer === false ||
    product.publicationEligibility === "PUBLICATION_HOLD" ||
    product.publicationEligibility === "PUBLICATION_BLOCKED";
  return held ? "hold" : "public";
}
