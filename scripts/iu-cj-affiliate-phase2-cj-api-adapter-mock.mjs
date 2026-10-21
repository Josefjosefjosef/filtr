/** Offline CJ API responses for integration tests (synthetic data). */
export function mockCjLinkSearchResponse(query = {}) {
  return {
    ok: true,
    mock: true,
    links: [
      {
        linkId: query.linkId || "17361433",
        advertiserId: query.advertiserId || "5277391",
        linkType: query.linkType || "coupon",
        description: "Synthetic coupon link for offline test",
        promotionType: "coupon",
        customerDiscountHint: "20%",
        publisherCommissionHint: "5%",
      },
    ],
  };
}

export function mockCjAdvertiserLookup(advertiserId) {
  return {
    ok: true,
    mock: true,
    advertisers: [{ advertiserId: advertiserId || "5277391", accountStatus: "Active", primaryCountry: "CZ" }],
  };
}

export function mockInvalidCjTokenResponse() {
  return { ok: false, httpStatus: 401, reason: "invalid_pat", mock: true };
}
