import { describe, expect, it } from "vitest";
import {
  buildPremiumAdWebPlacementUrl,
  isFunctionalPremiumAdWebPlacementUrl,
  normalizePremiumAdWebPlacementUrl,
  PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM,
  PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE,
  PREMIUM_SITE_ORIGIN,
  resolvePremiumAdWebPlacementUrl,
} from "../src/premium-ad-web-placement";
import { PREMIUM_AFFILIATE_CATEGORY_SLUGS } from "../src/premium-selected-services";
import {
  defaultRepoRootFromAdsModule,
  readAffiliateCatalogSectionIdsFromRepo,
} from "../src/premium-affiliate-catalog-ids";

function expectedUrlForSlug(slug: string): string {
  const url = new URL("/", PREMIUM_SITE_ORIGIN);
  url.searchParams.set("section", slug);
  url.searchParams.set(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM, PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE);
  return url.toString();
}

describe("premium ad web placement URLs", () => {
  it("maps every affiliate category slug to a tool-window section URL", () => {
    for (const slug of PREMIUM_AFFILIATE_CATEGORY_SLUGS) {
      const url = buildPremiumAdWebPlacementUrl(slug);
      expect(url).toBe(expectedUrlForSlug(slug));
      expect(isFunctionalPremiumAdWebPlacementUrl(url!)).toBe(true);
    }
  });

  it("returns null for unknown slugs", () => {
    expect(buildPremiumAdWebPlacementUrl("aff-not-real")).toBeNull();
    expect(buildPremiumAdWebPlacementUrl("")).toBeNull();
  });

  it("matches premium slugs to public affiliate catalog section ids", () => {
    const catalogIds = readAffiliateCatalogSectionIdsFromRepo(defaultRepoRootFromAdsModule());
    expect(catalogIds.length).toBeGreaterThan(20);
    for (const slug of PREMIUM_AFFILIATE_CATEGORY_SLUGS) {
      expect(catalogIds).toContain(slug);
      expect(buildPremiumAdWebPlacementUrl(slug)).toBe(expectedUrlForSlug(slug));
    }
    expect(catalogIds.sort().join(",")).toBe([...PREMIUM_AFFILIATE_CATEGORY_SLUGS].sort().join(","));
  });

  it("does not confuse similar slug names", () => {
    const a = buildPremiumAdWebPlacementUrl("aff-realitni-kancelare");
    const b = buildPremiumAdWebPlacementUrl("aff-reality-nemovitosti");
    expect(a).not.toBe(b);
    expect(a).toContain("aff-realitni-kancelare");
    expect(b).toContain("aff-reality-nemovitosti");
  });

  it("normalizes legacy snapshots without stripping extra query params", () => {
    const legacy =
      "https://infouzel.cz/?section=aff-cestovni-kancelare&legacy=1&trace=" + "y".repeat(20);
    const normalized = normalizePremiumAdWebPlacementUrl(legacy);
    expect(normalized).toContain("legacy=1");
    expect(normalized).toContain(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM + "=" + PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE);
    expect(resolvePremiumAdWebPlacementUrl({ category_slug: "aff-cestovni-kancelare", snapshot_url: legacy })).toBe(
      normalized
    );
  });

  it("rebuilds from category slug when snapshot path is not a section URL", () => {
    const snap = "https://infouzel.cz/affiliate/software";
    expect(resolvePremiumAdWebPlacementUrl({ category_slug: "aff-software", snapshot_url: snap })).toBe(
      expectedUrlForSlug("aff-software")
    );
  });
});
