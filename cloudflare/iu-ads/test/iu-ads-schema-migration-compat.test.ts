import { describe, expect, it } from "vitest";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { premiumPlacementId } from "../src/premium-selected-services";

describe("iu-ads D1 schema migration compat (B3 freeze)", () => {
  it("applies all migrations with pending-placement unique index and P1–P8 seeds", () => {
    const db = createIuAdsSchemaDb();
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_premium_selected_orders_pending_placement'"
      )
      .get() as { name: string } | undefined;
    expect(idx?.name).toBe("idx_premium_selected_orders_pending_placement");

    const placementId = premiumPlacementId("aff-zdravi-doplnky", 1);
    const row = db
      .prepare(
        "SELECT position, current_price_cents, currency FROM premium_selected_placements WHERE placement_id = ?"
      )
      .get(placementId) as { position: number; current_price_cents: number; currency: string };
    expect(row.position).toBe(1);
    expect(row.current_price_cents).toBe(599000);
    expect(row.currency).toBe("CZK");

    const positions = db
      .prepare(
        "SELECT COUNT(*) AS c FROM premium_selected_placements WHERE category_slug = 'aff-zdravi-doplnky'"
      )
      .get() as { c: number };
    expect(Number(positions.c)).toBe(8);
  });
});
