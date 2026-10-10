import { describe, expect, it } from "vitest";
import {
  defaultRepoRootFromAdsModule,
  readAffiliateCatalogSectionTitlesFromRepo,
} from "../src/premium-affiliate-catalog-ids";
import { PREMIUM_AFFILIATE_CATEGORY_TITLES_CS } from "../src/premium-affiliate-catalog-titles";
import {
  PREMIUM_AFFILIATE_CATEGORY_SLUGS,
  premiumCategoryTitleCs,
} from "../src/premium-selected-services";

describe("affiliate section public titles (InfoUzel.cz catalog parity)", () => {
  const catalogTitles = readAffiliateCatalogSectionTitlesFromRepo(defaultRepoRootFromAdsModule());

  it("bundled titles match assets/iu-affiliate-catalog.js for every premium slug", () => {
    expect(Object.keys(catalogTitles).length).toBeGreaterThanOrEqual(PREMIUM_AFFILIATE_CATEGORY_SLUGS.length);
    for (const slug of PREMIUM_AFFILIATE_CATEGORY_SLUGS) {
      expect(catalogTitles[slug], "missing catalog title for " + slug).toBeTruthy();
      expect(PREMIUM_AFFILIATE_CATEGORY_TITLES_CS[slug]).toBe(catalogTitles[slug]);
      expect(premiumCategoryTitleCs(slug)).toBe(catalogTitles[slug]);
    }
  });

  it("does not truncate multi-word titles to the first slug segment", () => {
    const samples: Array<[string, string]> = [
      ["aff-software", "Software a bezpečnost"],
      ["aff-dum-zahrada", "Dům a zahrada"],
      ["aff-kosmetika", "Kosmetika a parfémy"],
      ["aff-letenky", "Doprava a cestování"],
      ["aff-ubytovani-hotely", "Ubytování a hotely"],
      ["aff-elektro", "Elektro a chytrá domácnost"],
    ];
    for (const [slug, expected] of samples) {
      expect(premiumCategoryTitleCs(slug)).toBe(expected);
      expect(premiumCategoryTitleCs(slug)).not.toBe("Software");
      expect(premiumCategoryTitleCs(slug)).not.toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("covers every catalog affiliate section id in the bundled map", () => {
    for (const slug of Object.keys(catalogTitles).sort()) {
      expect(PREMIUM_AFFILIATE_CATEGORY_TITLES_CS[slug]).toBe(catalogTitles[slug]);
    }
  });
});
