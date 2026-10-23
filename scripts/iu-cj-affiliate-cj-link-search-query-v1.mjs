/**
 * CJ Link Search v2 query builder (offline-safe). Coupon filters use promotion-type, not link-type.
 */

export function buildCjLinkSearchQueryParams(websitePid, pageNumber, options = {}) {
  const qs = new URLSearchParams({
    "website-id": String(websitePid),
    "advertiser-ids": "joined",
    "page-number": String(pageNumber),
    "records-per-page": String(options.recordsPerPage ?? 10),
  });
  if (options.linkType) {
    qs.set("link-type", String(options.linkType));
  } else {
    qs.set("promotion-type", String(options.promotionType ?? "coupon"));
  }
  return qs;
}

export function buildCjLinkSearchProbePage1QueryString(websitePid) {
  return buildCjLinkSearchQueryParams(websitePid, 1, { recordsPerPage: 10 }).toString();
}
