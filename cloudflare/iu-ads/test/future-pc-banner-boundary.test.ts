import { describe, expect, it, vi } from "vitest";
import * as adminAuth from "../src/admin-auth";
import { handleAdminBannerPcPlaceholder } from "../src/admin-invoices-registry";
import type { Env } from "../src/types";

describe("future PC banner boundary (B4 freeze)", () => {
  it("admin placeholder returns no orders and states P1–P8 unchanged", async () => {
    vi.spyOn(adminAuth, "requireAdminPermission").mockResolvedValue({
      ok: true,
      user: {
        user_id: "adm",
        email: "a@test",
        display_name: "Admin",
        roles: ["main_admin"],
        permissions: ["orders.read"],
      },
    });

    const res = await handleAdminBannerPcPlaceholder(new Request("https://ads.test/v1/admin/banner-pc"), {} as Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: unknown[]; message_cs: string; product_status_cs: string };
    expect(body.orders).toEqual([]);
    expect(body.product_status_cs).toBe("Připravuje se");
    expect(body.message_cs).toMatch(/P1–P8/);
  });
});
