import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPublicDeliveryActive, resolveFeatureFlags } from "../src/feature-flags";
import {
  ANALYTICS_ONLY_TABLES,
  assertNoForbiddenPublicKeys,
  emptyPublicDelivery,
  sanitizePublicAds,
} from "../src/isolation";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("feature flags fail-closed", () => {
  it("defaults to safe mode on and APIs off", () => {
    const f = resolveFeatureFlags({});
    expect(f.safeMode).toBe(true);
    expect(f.publicDeliveryEnabled).toBe(false);
    expect(f.adminApiEnabled).toBe(false);
    expect(f.clientApiEnabled).toBe(false);
    expect(isPublicDeliveryActive(f)).toBe(false);
  });

  it("public delivery requires enabled AND safeMode off", () => {
    expect(
      isPublicDeliveryActive(
        resolveFeatureFlags({
          ADS_SAFE_MODE: "false",
          ADS_PUBLIC_DELIVERY_ENABLED: "true",
        })
      )
    ).toBe(true);
    expect(
      isPublicDeliveryActive(
        resolveFeatureFlags({
          ADS_SAFE_MODE: "true",
          ADS_PUBLIC_DELIVERY_ENABLED: "true",
        })
      )
    ).toBe(false);
  });
});

describe("public delivery isolation", () => {
  it("empty delivery has no forbidden keys", () => {
    const body = emptyPublicDelivery(false, true);
    expect(assertNoForbiddenPublicKeys(body)).toEqual([]);
    expect(body.ads).toEqual([]);
  });

  it("detects forbidden keys in payload", () => {
    const leaks = assertNoForbiddenPublicKeys({
      ads: [{ campaign_id: "c1", price_cents: 100, note_internal: "x" }],
    });
    expect(leaks.some((x) => x.includes("price_cents"))).toBe(true);
    expect(leaks.some((x) => x.includes("note_internal"))).toBe(true);
  });

  it("sanitizePublicAds keeps allowlisted shape only", () => {
    const ads = sanitizePublicAds([
      {
        campaign_id: "c1",
        placement_id: "p1",
        section_id: "home",
        slot_type: "banner",
        device_category: "pc",
        label: "Reklama",
        creative: { format: "image", width: 300, height: 250, cdn_url: "https://example.test/a.png" },
        target_url: "https://example.test/",
        anchor: "after-3",
      },
    ]);
    expect(assertNoForbiddenPublicKeys({ ads })).toEqual([]);
    expect(Object.keys(ads[0]).sort()).toEqual(
      [
        "anchor",
        "campaign_id",
        "creative",
        "device_category",
        "label",
        "placement_id",
        "section_id",
        "slot_type",
        "target_url",
      ].sort()
    );
  });
});

describe("schema isolation from analytics aggregates", () => {
  it("iu-ads SQL must not define analytics daily_* tables", () => {
    const sql = readFileSync(join(root, "migrations", "0001_init.sql"), "utf8").toLowerCase();
    for (const table of ANALYTICS_ONLY_TABLES) {
      expect(sql.includes("create table if not exists " + table)).toBe(false);
      expect(sql.includes("create table " + table)).toBe(false);
    }
    expect(sql.includes("password_hash")).toBe(true);
    expect(sql.includes("code_hash")).toBe(true);
    expect(sql.includes("create table if not exists campaigns")).toBe(true);
  });

  it("etapa 7 migration 0008 adds client_login_attempts without analytics tables", () => {
    const sql = readFileSync(join(root, "migrations", "0008_client_codes.sql"), "utf8").toLowerCase();
    for (const table of ANALYTICS_ONLY_TABLES) {
      expect(sql.includes("create table if not exists " + table)).toBe(false);
      expect(sql.includes("create table " + table)).toBe(false);
    }
    expect(sql.includes("client_login_attempts")).toBe(true);
    expect(sql.includes("'0008'")).toBe(true);
  });

  it("etapa 8 migration 0009 adds alert indexes without new analytics tables", () => {
    const sql = readFileSync(join(root, "migrations", "0009_admin_ops.sql"), "utf8").toLowerCase();
    for (const table of ANALYTICS_ONLY_TABLES) {
      expect(sql.includes("create table if not exists " + table)).toBe(false);
      expect(sql.includes("create table " + table)).toBe(false);
    }
    expect(sql.includes("idx_alerts_type_status")).toBe(true);
    expect(sql.includes("'0009'")).toBe(true);
    expect(sql.includes("create table")).toBe(false);
  });

  it("traceability matrix covers chapters 1-48", () => {
    const matrixPath = join(root, "..", "..", "docs", "ads-system", "01-traceability-matrix.json");
    const matrix = JSON.parse(readFileSync(matrixPath, "utf8")) as {
      chapters: Array<{ id: string }>;
    };
    const ids = new Set(matrix.chapters.map((c) => c.id));
    expect(ids.has("goal")).toBe(true);
    for (let i = 1; i <= 48; i++) {
      expect(ids.has(String(i))).toBe(true);
    }
  });
});
