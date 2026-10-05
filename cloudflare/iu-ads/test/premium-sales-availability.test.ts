import { describe, expect, it } from "vitest";
import {
  defaultPriceCentsForPosition,
  isPremiumSlotPubliclyListed,
  parsePremiumPlacementId,
  premiumPlacementId,
} from "../src/premium-selected-services";
import { resolvePremiumPublicSaleState } from "../src/premium-display";

function buyableFor(input: {
  active_campaign_id: string | null;
  campaign_live: boolean;
  pending_order_count: number;
}): boolean {
  return resolvePremiumPublicSaleState(input) === "available";
}

describe("premium sales catalog — P1–P8 always listed", () => {
  it("lists all eight positions regardless of legacy premium_capacity", () => {
    for (const cap of [2, 4, 8] as const) {
      for (let pos = 1; pos <= 8; pos++) {
        expect(isPremiumSlotPubliclyListed(cap, pos as import("../src/premium-selected-services").PremiumPosition)).toBe(true);
      }
    }
  });
});

describe("FREE category invariant", () => {
  const freeSlot = {
    active_campaign_id: null,
    campaign_live: false,
    pending_order_count: 0,
  };

  it("P1–P8 buyable when unoccupied", () => {
    for (let _ = 0; _ < 8; _++) {
      expect(buyableFor(freeSlot)).toBe(true);
    }
  });
});

describe("position independence", () => {
  const free = {
    active_campaign_id: null,
    campaign_live: false,
    pending_order_count: 0,
  };
  const occupied = {
    active_campaign_id: "c-active",
    campaign_live: true,
    pending_order_count: 0,
  };
  const reserved = {
    active_campaign_id: null,
    campaign_live: false,
    pending_order_count: 1,
  };

  it("FREE slots stay buyable when another position is ACTIVE", () => {
    expect(buyableFor(free)).toBe(true);
    expect(buyableFor(occupied)).toBe(false);
  });

  it("pending order holds slot only for that placement", () => {
    expect(buyableFor(reserved)).toBe(false);
    expect(buyableFor(free)).toBe(true);
  });

  it("mixed occupancy scenario", () => {
    expect(buyableFor(free)).toBe(true);
    expect(buyableFor(occupied)).toBe(false);
    expect(buyableFor(reserved)).toBe(false);
  });
});

describe("order routing prices (server defaults)", () => {
  it("P5–P8 use independent placement ids and prices", () => {
    const cat = "aff-cestovni-kancelare";
    const p5 = premiumPlacementId(cat, 5);
    const p8 = premiumPlacementId(cat, 8);
    expect(parsePremiumPlacementId(p5)?.position).toBe(5);
    expect(parsePremiumPlacementId(p8)?.position).toBe(8);
    expect(defaultPriceCentsForPosition(5)).toBe(479000);
    expect(defaultPriceCentsForPosition(8)).toBe(389000);
  });
});
