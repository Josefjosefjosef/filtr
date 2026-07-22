import { describe, expect, it } from "vitest";
import { isTestAdCampaignId } from "../src/ads-policy";

describe("isTestAdCampaignId", () => {
  it("marks verification prefixes as test", () => {
    expect(isTestAdCampaignId("test_verify_c1")).toBe(true);
    expect(isTestAdCampaignId("test-verify")).toBe(true);
    expect(isTestAdCampaignId("test.campaign")).toBe(true);
    expect(isTestAdCampaignId("test")).toBe(true);
  });

  it("keeps real campaign ids", () => {
    expect(isTestAdCampaignId("spring_sale")).toBe(false);
    expect(isTestAdCampaignId("contest_main")).toBe(false);
    expect(isTestAdCampaignId("latest_promo")).toBe(false);
    expect(isTestAdCampaignId("")).toBe(false);
  });
});
