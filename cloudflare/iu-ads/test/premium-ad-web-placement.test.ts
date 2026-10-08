import { describe, expect, it } from "vitest";
import { buildPremiumAdWebPlacementUrl, PREMIUM_SITE_ORIGIN } from "../src/premium-ad-web-placement";
import { PREMIUM_AFFILIATE_CATEGORY_SLUGS } from "../src/premium-selected-services";

describe("premium ad web placement URLs", () => {
  it("maps every affiliate category slug to a section URL", () => {
    for (const slug of PREMIUM_AFFILIATE_CATEGORY_SLUGS) {
      const url = buildPremiumAdWebPlacementUrl(slug);
      expect(url).toBe(PREMIUM_SITE_ORIGIN + "/?section=" + encodeURIComponent(slug));
    }
  });

  it("returns null for unknown slugs", () => {
    expect(buildPremiumAdWebPlacementUrl("aff-not-real")).toBeNull();
    expect(buildPremiumAdWebPlacementUrl("")).toBeNull();
  });

  it("does not confuse similar slug names", () => {
    const a = buildPremiumAdWebPlacementUrl("aff-realitni-kancelare");
    const b = buildPremiumAdWebPlacementUrl("aff-reality-nemovitosti");
    expect(a).not.toBe(b);
    expect(a).toContain("aff-realitni-kancelare");
    expect(b).toContain("aff-reality-nemovitosti");
  });
});
