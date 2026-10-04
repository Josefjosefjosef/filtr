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

describe("premium sales catalog — P1–P4 always listed", () => {
  it("lists all four positions regardless of legacy premium_capacity", () => {
    for (const cap of [2, 4] as const) {
      for (const pos of [1, 2, 3, 4] as const) {
        expect(isPremiumSlotPubliclyListed(cap, pos)).toBe(true);
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

  it("P1–P4 buyable when unoccupied", () => {
    for (const _ of [1, 2, 3, 4]) {
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

  it("FREE slots stay buyable when another position is ACTIVE", () => {
    expect(buyableFor(free)).toBe(true);
    expect(buyableFor(occupied)).toBe(false);
  });

  it("OCCUPIED P3 blocks only P3", () => {
    expect(buyableFor(occupied)).toBe(false);
    expect(buyableFor(free)).toBe(true);
  });

  it("pending order holds slot only for that placement", () => {
    expect(
      buyableFor({
        active_campaign_id: null,
        campaign_live: false,
        pending_order_count: 1,
      })
    ).toBe(false);
    expect(buyableFor(free)).toBe(true);
  });
});

describe("order routing prices (server defaults)", () => {
  it("P3/P4 use independent placement ids and prices", () => {
    const cat = "aff-cestovni-kancelare";
    const p3 = premiumPlacementId(cat, 3);
    const p4 = premiumPlacementId(cat, 4);
    expect(parsePremiumPlacementId(p3)?.position).toBe(3);
    expect(parsePremiumPlacementId(p4)?.position).toBe(4);
    expect(defaultPriceCentsForPosition(3)).toBe(399000);
    expect(defaultPriceCentsForPosition(4)).toBe(299000);
  });
});
