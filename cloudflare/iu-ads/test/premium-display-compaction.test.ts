import { describe, expect, it } from "vitest";
import {
  assignPremiumDisplayRanks,
  premiumPositionRankLabelCs,
  resolvePremiumPublicSaleState,
  sortPremiumByContractedPosition,
} from "../src/premium-display";

describe("premium display compaction", () => {
  it("assigns display ranks without changing contracted position", () => {
    const ranked = assignPremiumDisplayRanks([
      { placement_id: "p3", position: 3 },
      { placement_id: "p1", position: 1 },
    ]);
    expect(ranked.map((r) => r.placement_id)).toEqual(["p1", "p3"]);
    expect(ranked[0].display_rank).toBe(1);
    expect(ranked[1].display_rank).toBe(2);
    expect(ranked[0].position).toBe(1);
    expect(ranked[1].position).toBe(3);
  });

  it("covers matrix examples A-E", () => {
    const onlyP8 = assignPremiumDisplayRanks([{ position: 8, id: "a" }]);
    expect(onlyP8.map((x) => x.position)).toEqual([8]);
    expect(onlyP8[0].display_rank).toBe(1);

    const p2p8 = assignPremiumDisplayRanks([
      { position: 8, id: "b" },
      { position: 2, id: "a" },
    ]);
    expect(p2p8.map((x) => x.position)).toEqual([2, 8]);

    const p1p4p7 = assignPremiumDisplayRanks([
      { position: 7, id: "c" },
      { position: 1, id: "a" },
      { position: 4, id: "b" },
    ]);
    expect(p1p4p7.map((x) => x.position)).toEqual([1, 4, 7]);

    const p3p5p6p8 = assignPremiumDisplayRanks([
      { position: 8, id: "d" },
      { position: 5, id: "b" },
      { position: 3, id: "a" },
      { position: 6, id: "c" },
    ]);
    expect(p3p5p6p8.map((x) => x.position)).toEqual([3, 5, 6, 8]);

    const all = assignPremiumDisplayRanks(
      [1, 2, 3, 4, 5, 6, 7, 8].map((position) => ({ position, id: "p" + position }))
    );
    expect(sortPremiumByContractedPosition(all).map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(all.find((x) => x.position === 8)?.display_rank).toBe(8);
  });

  it("position labels through P8", () => {
    expect(premiumPositionRankLabelCs(1)).toBe("1. pozice v této sekci");
    expect(premiumPositionRankLabelCs(8)).toBe("8. pozice v této sekci");
  });

  it("sale state authority", () => {
    expect(
      resolvePremiumPublicSaleState({
        active_campaign_id: null,
        campaign_live: false,
        pending_order_count: 0,
      })
    ).toBe("available");
    expect(
      resolvePremiumPublicSaleState({
        active_campaign_id: "c1",
        campaign_live: true,
        pending_order_count: 0,
      })
    ).toBe("live");
    expect(
      resolvePremiumPublicSaleState({
        active_campaign_id: "c1",
        campaign_live: false,
        pending_order_count: 0,
      })
    ).toBe("held");
  });
});
