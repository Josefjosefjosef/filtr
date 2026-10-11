import { describe, expect, it } from "vitest";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";
import {
  isPremiumDevOperationalResetEnabled,
  PREMIUM_DEV_OPERATIONAL_RESET_SETTING_KEY,
} from "../src/premium-dev-operational-reset-guard";
import type { Env } from "../src/types";

describe("premium dev operational reset guard", () => {
  it("allows reset by default during pre-launch", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(sqlite) } as Env;
    expect(await isPremiumDevOperationalResetEnabled(env)).toBe(true);
  });

  it("blocks when PREMIUM_COMMERCIAL_LIVE is set", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(sqlite), PREMIUM_COMMERCIAL_LIVE: "1" } as Env;
    expect(await isPremiumDevOperationalResetEnabled(env)).toBe(false);
  });

  it("blocks when Worker var explicitly disables", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(sqlite), PREMIUM_DEV_OPERATIONAL_RESET_ENABLED: "0" } as Env;
    expect(await isPremiumDevOperationalResetEnabled(env)).toBe(false);
  });

  it("respects D1 setting when Worker var unset", async () => {
    const sqlite = createIuAdsSchemaDb();
    sqlite
      .prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run(PREMIUM_DEV_OPERATIONAL_RESET_SETTING_KEY, "0", "2026-01-01T00:00:00.000Z");
    const env = { DB: d1FromSqlite(sqlite) } as Env;
    expect(await isPremiumDevOperationalResetEnabled(env)).toBe(false);
  });
});
