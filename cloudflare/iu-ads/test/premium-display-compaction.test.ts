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

  it("covers matrix examples", () => {
    const onlyP3 = assignPremiumDisplayRanks([{ position: 3, id: "a" }]);
    expect(onlyP3[0].display_rank).toBe(1);

    const p1p3 = assignPremiumDisplayRanks([
      { position: 3, id: "b" },
      { position: 1, id: "a" },
    ]);
    expect(p1p3.map((x) => x.display_rank)).toEqual([1, 2]);

    const all = assignPremiumDisplayRanks([
      { position: 4, id: "d" },
      { position: 2, id: "b" },
      { position: 1, id: "a" },
      { position: 3, id: "c" },
    ]);
    expect(sortPremiumByContractedPosition(all).map((x) => x.position)).toEqual([1, 2, 3, 4]);
    expect(all.find((x) => x.position === 4)?.display_rank).toBe(4);
  });

  it("position labels", () => {
    expect(premiumPositionRankLabelCs(1)).toBe("1. pozice v této sekci");
    expect(premiumPositionRankLabelCs(4)).toBe("4. pozice v této sekci");
  });

  it("sale state authority", () => {
    expect(
      resolvePremiumPublicSaleState({
        publicly_listed: true,
        active_campaign_id: null,
        campaign_live: false,
        pending_order_count: 0,
      })
    ).toBe("available");
    expect(
      resolvePremiumPublicSaleState({
        publicly_listed: true,
        active_campaign_id: "c1",
        campaign_live: true,
        pending_order_count: 0,
      })
    ).toBe("live");
    expect(
      resolvePremiumPublicSaleState({
        publicly_listed: true,
        active_campaign_id: "c1",
        campaign_live: false,
        pending_order_count: 0,
      })
    ).toBe("held");
  });
});
