import { describe, expect, it } from "vitest";
import { isPremiumCampaignLiveNow } from "../src/premium-display";

/** Mirrors delivery-engine withinWindow used for public ad eligibility. */
function withinWindow(startAt: string | null, endAt: string | null, nowIso: string): boolean {
  if (startAt && startAt > nowIso) return false;
  if (endAt && endAt < nowIso) return false;
  return true;
}

describe("premium extend public delivery window", () => {
  it("extended campaign end keeps ad live through new period (delivery window)", () => {
    const start = "2026-10-10T00:00:00.000Z";
    const oldEnd = "2027-04-10T00:00:00.000Z";
    const newEnd = "2027-10-10T00:00:00.000Z";
    const midOld = "2027-03-01T12:00:00.000Z";
    const midNew = "2027-08-01T12:00:00.000Z";
    const afterNew = "2027-11-01T12:00:00.000Z";

    expect(withinWindow(start, oldEnd, midOld)).toBe(true);
    expect(withinWindow(start, oldEnd, midNew)).toBe(false);

    expect(withinWindow(start, newEnd, midNew)).toBe(true);
    expect(isPremiumCampaignLiveNow({
      campaign_status: "active",
      target_url: "https://example.invalid/ad",
      start_at: start,
      end_at: newEnd,
      nowIso: midNew,
    })).toBe(true);
    expect(withinWindow(start, newEnd, afterNew)).toBe(false);
  });
});
