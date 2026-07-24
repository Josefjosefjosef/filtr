import { describe, expect, it } from "vitest";
import {
  assertNoForbiddenBackupKeys,
  buildBackupInventory,
  decryptBackupPayload,
  encryptBackupPayload,
  inventoryCanonicalJson,
  PRIVACY_FAIL_CLOSED,
  redactBackupValue,
  runRestoreDrill,
  selectExpiredBackupIds,
  sha256Hex,
} from "../src/backup";
import { resolveFeatureFlags, isPublicDeliveryActive } from "../src/feature-flags";
import { hasPermission } from "../src/rbac";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("backup inventory redaction + restore drill", () => {
  it("redacts password_hash / access_code / secrets from inventory", () => {
    const inv = buildBackupInventory({
      schemaVersion: "0010",
      createdAt: "2026-01-01T00:00:00.000Z",
      tables: [
        {
          name: "admin_users",
          count: 1,
          sample: [{ user_id: "u1", email: "a@b.cz", password_hash: "SHOULD_NOT_SURVIVE", access_code: "IU-SECRET" }],
        },
      ],
    });
    const leaks = assertNoForbiddenBackupKeys(inv);
    expect(leaks).toEqual([]);
    expect(JSON.stringify(inv)).not.toContain("SHOULD_NOT_SURVIVE");
    expect(JSON.stringify(inv)).not.toContain("IU-SECRET");
    expect(inv.tables[0].sample?.[0]).toEqual({ user_id: "u1", email: "a@b.cz" });
  });

  it("detects forbidden keys when redaction is skipped", () => {
    const leaks = assertNoForbiddenBackupKeys({ password_hash: "x", nested: { ADS_SESSION_SECRET: "y" } });
    expect(leaks.some((l) => l.includes("password_hash"))).toBe(true);
    expect(leaks.some((l) => l.includes("ADS_SESSION_SECRET"))).toBe(true);
  });

  it("restore drill passes when hash matches and fails on mismatch / leaks", async () => {
    const inventory = buildBackupInventory({
      schemaVersion: "0010",
      createdAt: "2026-01-01T00:00:00.000Z",
      tables: [{ name: "campaigns", count: 2 }],
    });
    const hash = await sha256Hex(inventoryCanonicalJson(inventory));
    const ok = await runRestoreDrill({ content_hash: hash, encryption: "none", status: "manifest_only" }, inventory);
    expect(ok.ok).toBe(true);

    const badHash = await runRestoreDrill(
      { content_hash: "deadbeef", encryption: "none", status: "manifest_only" },
      inventory
    );
    expect(badHash.ok).toBe(false);
    expect(badHash.reason).toBe("hash_mismatch");

    const leaky = { ...inventory, tables: [...inventory.tables, { name: "x", count: 0, sample: [{ token: "t" }] }] };
    const leakDrill = await runRestoreDrill(
      { content_hash: hash, encryption: "none", status: "manifest_only" },
      leaky as typeof inventory
    );
    expect(leakDrill.ok).toBe(false);
    expect(leakDrill.reason).toBe("forbidden_keys");
  });

  it("AES-GCM encrypt/decrypt round-trip (ADS_BACKUP_ENCRYPTION_KEY material)", async () => {
    const plain = inventoryCanonicalJson(
      buildBackupInventory({
        schemaVersion: "0010",
        createdAt: "2026-01-01T00:00:00.000Z",
        tables: [{ name: "clients", count: 3 }],
      })
    );
    const { ciphertextB64, encryption } = await encryptBackupPayload(plain, "test-backup-key-not-a-secret-in-prod");
    expect(encryption).toBe("aes-256-gcm");
    expect(ciphertextB64).not.toContain("clients");
    const round = await decryptBackupPayload(ciphertextB64, "test-backup-key-not-a-secret-in-prod");
    expect(round).toBe(plain);
  });

  it("selectExpiredBackupIds respects retention days", () => {
    const now = Date.parse("2026-07-23T00:00:00.000Z");
    const ids = selectExpiredBackupIds(
      [
        { backup_id: "old", created_at: "2026-01-01T00:00:00.000Z" },
        { backup_id: "fresh", created_at: "2026-07-20T00:00:00.000Z" },
      ],
      30,
      now
    );
    expect(ids).toEqual(["old"]);
  });

  it("redactBackupValue is idempotent", () => {
    const once = redactBackupValue({ a: 1, password: "x", nested: { code_hash: "y", ok: true } });
    expect(once).toEqual({ a: 1, nested: { ok: true } });
    expect(redactBackupValue(once)).toEqual(once);
  });
});

describe("kap.14 privacy + fail-closed flags", () => {
  it("privacy defaults are contextual-only / no tracking cookies", () => {
    expect(PRIVACY_FAIL_CLOSED.PERSONALIZED_ADS).toBe("NO");
    expect(PRIVACY_FAIL_CLOSED.RETARGETING).toBe("NO");
    expect(PRIVACY_FAIL_CLOSED.PROFILING).toBe("NO");
    expect(PRIVACY_FAIL_CLOSED.AD_TRACKING_COOKIES).toBe("NO");
    expect(PRIVACY_FAIL_CLOSED.CONTEXTUAL_ADS_ONLY).toBe("YES");
  });

  it("0001 seed SQL contains privacy fail-closed settings", () => {
    const sql = readFileSync(join(root, "migrations", "0001_init.sql"), "utf8");
    for (const [k, v] of Object.entries(PRIVACY_FAIL_CLOSED)) {
      expect(sql).toContain("'" + k + "', '" + v + "'");
    }
  });

  it("wrangler defaults keep ads OFF", () => {
    const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(toml).toMatch(/ADS_SAFE_MODE\s*=\s*"true"/);
    expect(toml).toMatch(/ADS_PUBLIC_DELIVERY_ENABLED\s*=\s*"false"/);
    expect(toml).toMatch(/ADS_ADMIN_API_ENABLED\s*=\s*"false"/);
    expect(toml).toMatch(/ADS_CLIENT_API_ENABLED\s*=\s*"false"/);
    const f = resolveFeatureFlags({
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
      ADS_ADMIN_API_ENABLED: "false",
      ADS_CLIENT_API_ENABLED: "false",
    });
    expect(isPublicDeliveryActive(f)).toBe(false);
  });
});

describe("RBAC Etapa 9 backups — main_admin only", () => {
  it("main_admin has backups.read/write; other roles do not", () => {
    expect(hasPermission(["main_admin"], "backups.read")).toBe(true);
    expect(hasPermission(["main_admin"], "backups.write")).toBe(true);
    expect(hasPermission(["ads_manager"], "backups.read")).toBe(false);
    expect(hasPermission(["ads_manager"], "backups.write")).toBe(false);
    expect(hasPermission(["sales"], "backups.write")).toBe(false);
    expect(hasPermission(["read_only"], "backups.read")).toBe(false);
  });
});

describe("migration 0010", () => {
  it("bumps schema to 0010 without analytics tables", () => {
    const sql = readFileSync(join(root, "migrations", "0010_backup_security.sql"), "utf8").toLowerCase();
    expect(sql.includes("'0010'")).toBe(true);
    expect(sql.includes("backup_retention_days")).toBe(true);
    expect(sql.includes("create table")).toBe(false);
    expect(sql.includes("daily_traffic")).toBe(false);
    expect(sql.includes("daily_ads")).toBe(false);
  });
});
