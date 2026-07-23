import { describe, expect, it } from "vitest";
import { findCollision, hasCollision, isCollisionMode, type ReservationWindow } from "../src/collision";

function window(overrides: Partial<ReservationWindow> = {}): ReservationWindow {
  return {
    placement_id: "plc_header",
    device_category: "pc",
    section_id: "global_header",
    region_code: null,
    start_at: "2026-08-01T00:00:00Z",
    end_at: "2026-08-08T00:00:00Z",
    status: "reserved",
    ...overrides,
  };
}

describe("isCollisionMode", () => {
  it("accepts only exclusive/shared", () => {
    expect(isCollisionMode("exclusive")).toBe(true);
    expect(isCollisionMode("shared")).toBe(true);
    expect(isCollisionMode("weird")).toBe(false);
    expect(isCollisionMode(undefined)).toBe(false);
  });
});

describe("reservation collision detection (kap. 11)", () => {
  it("blocks an overlapping window on an exclusive placement", () => {
    const existing = [window({ reservation_id: "rsv_1" })];
    const candidate = window({ start_at: "2026-08-05T00:00:00Z", end_at: "2026-08-12T00:00:00Z" });
    const collision = findCollision(candidate, existing, "exclusive");
    expect(collision?.reservation_id).toBe("rsv_1");
    expect(hasCollision(candidate, existing, "exclusive")).toBe(true);
  });

  it("allows a strictly adjacent (non-overlapping) window", () => {
    const existing = [window({ reservation_id: "rsv_1", end_at: "2026-08-08T00:00:00Z" })];
    const candidate = window({ start_at: "2026-08-08T00:00:00Z", end_at: "2026-08-15T00:00:00Z" });
    expect(hasCollision(candidate, existing, "exclusive")).toBe(false);
  });

  it("never collides on a shared-mode placement even with identical windows", () => {
    const existing = [window({ reservation_id: "rsv_1" })];
    const candidate = window();
    expect(hasCollision(candidate, existing, "shared")).toBe(false);
  });

  it("ignores cancelled/expired reservations", () => {
    const existing = [window({ reservation_id: "rsv_1", status: "cancelled" })];
    const candidate = window();
    expect(hasCollision(candidate, existing, "exclusive")).toBe(false);
  });

  it("does not collide across different placements, devices, sections, or regions", () => {
    const candidate = window();
    expect(hasCollision(candidate, [window({ reservation_id: "r1", placement_id: "plc_other" })], "exclusive")).toBe(false);
    expect(hasCollision(candidate, [window({ reservation_id: "r2", device_category: "mobile" })], "exclusive")).toBe(false);
    expect(hasCollision(candidate, [window({ reservation_id: "r3", section_id: "other_section" })], "exclusive")).toBe(false);
    expect(
      hasCollision(window({ region_code: "cz-praha" }), [window({ reservation_id: "r4", region_code: "cz-brno" })], "exclusive")
    ).toBe(false);
  });

  it("excludes itself when re-checking an existing reservation by id (update path)", () => {
    const existing = [window({ reservation_id: "rsv_1" })];
    const candidate = window({ reservation_id: "rsv_1" });
    expect(hasCollision(candidate, existing, "exclusive")).toBe(false);
  });
});
