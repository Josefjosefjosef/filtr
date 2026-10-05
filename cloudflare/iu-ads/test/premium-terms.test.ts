import { describe, expect, it } from "vitest";
import {
  PREMIUM_TERMS_V1_VERSION,
  PREMIUM_TERMS_V2_VERSION,
  PREMIUM_TERMS_VERSION,
  buildPremiumOrderKeyTermsHtml,
  buildPremiumTermsHtml,
  buildPremiumTermsV1Html,
  buildPremiumTermsV2Html,
} from "../src/premium-terms";
import { INFOUZEL_PROVIDER } from "../src/info-uzel-provider";

describe("premium B2B terms", () => {
  it("uses v3 as current version", () => {
    expect(PREMIUM_TERMS_VERSION).toBe("premium-selected-services-b2b-v3-20261005");
    expect(PREMIUM_TERMS_V1_VERSION).toContain("v1-");
    expect(PREMIUM_TERMS_V2_VERSION).toContain("v2-");
  });

  it("full terms include provider identity and no-tracking", () => {
    const html = buildPremiumTermsHtml("n");
    expect(html).toContain(INFOUZEL_PROVIDER.legalName);
    expect(html).toContain(INFOUZEL_PROVIDER.ico);
    expect(html).toContain("nesleduje");
    expect(html).toContain(PREMIUM_TERMS_VERSION);
    expect(html).toContain("/premium/terms/v1");
    expect(html).toContain("P1–P8");
  });

  it("v1 archive is preserved", () => {
    const html = buildPremiumTermsV1Html("n");
    expect(html).toContain(PREMIUM_TERMS_V1_VERSION);
    expect(html).toContain("archiv");
  });

  it("key terms summary for order page", () => {
    const html = buildPremiumOrderKeyTermsHtml();
    expect(html).toContain("Nejdůležitější podmínky");
    expect(html).toContain("IČO");
    expect(html).toContain("6 kalendářních měsíců");
    expect(html).toContain("nesleduje");
    expect(html).toContain("P1–P8");
  });

  it("v2 archive is preserved", () => {
    const html = buildPremiumTermsV2Html("n");
    expect(html).toContain(PREMIUM_TERMS_V2_VERSION);
    expect(html).toContain("archiv");
  });
});
