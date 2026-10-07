import { describe, expect, it } from "vitest";
import {
  isPremiumOrderPublishable,
  premiumOrderMissingPublishFields,
} from "../src/premium-order-workflow";

describe("premium order publishable gate", () => {
  it("requires creative_id and target_url for approve-publish", () => {
    expect(
      isPremiumOrderPublishable({
        workflow_status: "submitted",
        creative_id: null,
        target_url: "https://example.test/",
      })
    ).toBe(false);
    expect(
      isPremiumOrderPublishable({
        workflow_status: "under_review",
        creative_id: "crv_1",
        target_url: "https://example.test/",
      })
    ).toBe(true);
    expect(premiumOrderMissingPublishFields({ creative_id: null, target_url: "https://x.test/" })).toEqual([
      "creative",
    ]);
  });
});
