import { describe, expect, it } from "vitest";
import { ADMIN_NAV_CATALOG, ADMIN_NAV_ORDER_IDS, filterNavForRoles } from "../src/admin-nav";

describe("admin nav catalog (regression menu structure)", () => {
  it("matches frozen order ids for main_admin-visible entries", () => {
    const nav = filterNavForRoles(["main_admin"]);
    const ids = nav.map((n) => n.id);
    for (let i = 0; i < ADMIN_NAV_ORDER_IDS.length; i++) {
      const expected = ADMIN_NAV_ORDER_IDS[i];
      expect(ids[i]).toBe(expected);
    }
  });

  it("uses Czech labels for ad order block", () => {
    const byId = new Map(ADMIN_NAV_CATALOG.map((e) => [e.id, e.label_cs]));
    expect(byId.get("orders_all")).toBe("Všechny objednávky");
    expect(byId.get("premium")).toContain("Reklamní tlačítka");
    expect(byId.get("banner_pc")).toContain("Bannerová reklama");
    expect(byId.get("order_confirmations")).toBe("Potvrzení objednávek");
  });
});
