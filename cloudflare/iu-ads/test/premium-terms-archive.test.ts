import { describe, expect, it } from "vitest";
import { PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import { resolvePremiumTermsArchiveSource } from "../src/premium-terms-archive";

describe("premium terms archive source", () => {
  it("resolves known version to immutable HTML", () => {
    const src = resolvePremiumTermsArchiveSource(PREMIUM_TERMS_VERSION);
    expect(src).not.toBeNull();
    expect(src?.html).toContain(PREMIUM_TERMS_VERSION);
    expect(src?.html).toContain("<main>");
  });

  it("returns null for unknown version", () => {
    expect(resolvePremiumTermsArchiveSource("unknown-version-x")).toBeNull();
  });
});
