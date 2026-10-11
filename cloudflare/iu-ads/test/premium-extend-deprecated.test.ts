import { describe, expect, it, vi } from "vitest";
import { handleAdminPremiumExtend } from "../src/premium-admin-order-lifecycle";
import type { Env } from "../src/types";

vi.mock("../src/admin-auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/admin-auth")>();
  return {
    ...orig,
    requireAdminPermission: vi.fn(async () => ({ ok: true as const, userId: "usr_test", roles: ["main_admin"] })),
  };
});

describe("deprecated legacy extend endpoint", () => {
  it("returns 410 and points to extend-new-order", async () => {
    const env = {} as Env;
    const res = await handleAdminPremiumExtend(new Request("http://x/extend", { method: "POST" }), env, "ord_1");
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: string; use_path?: string };
    expect(body.error).toBe("deprecated_extend");
    expect(body.use_path).toContain("extend-new-order");
  });
});
