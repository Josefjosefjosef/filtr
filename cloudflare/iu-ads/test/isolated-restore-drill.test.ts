/**
 * Isolated restore drill: encrypt inventory → decrypt into a separate FakeD1/R2 world →
 * verify hash/tables → prove the "production" FakeD1 counts were not mutated.
 * Never targets real Cloudflare production D1.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildBackupInventory,
  decryptBackupPayload,
  encryptBackupPayload,
  inventoryCanonicalJson,
  runRestoreDrill,
  sha256Hex,
  type BackupInventory,
} from "../src/backup";

class FakeR2 {
  store = new Map<string, string>();
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async get(key: string) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return { text: async () => v };
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

function snapshotCounts(inv: BackupInventory): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of inv.tables) out[t.name] = t.count;
  return out;
}

describe("isolated restore drill (kap. 28/34)", () => {
  const KEY = "test-backup-encryption-key-not-for-prod";
  let prodInventory: BackupInventory;
  let prodCounts: Record<string, number>;

  beforeEach(() => {
    prodInventory = buildBackupInventory({
      schemaVersion: "0010",
      createdAt: "2026-07-25T12:00:00.000Z",
      notes: "isolated_drill_fixture",
      tables: [
        { name: "clients", count: 3 },
        { name: "campaigns", count: 5 },
        { name: "orders", count: 2 },
        { name: "contracts", count: 1 },
        { name: "invoices", count: 4 },
        { name: "documents", count: 7 },
        { name: "client_access_codes", count: 2 },
        { name: "system_settings", count: 12, sample: [{ key: "SCHEMA_VERSION", value: "0010" }] },
        { name: "backup_manifests", count: 1 },
      ],
    });
    prodCounts = snapshotCounts(prodInventory);
  });

  it("encrypts to isolated R2, decrypts, hash-matches, and leaves prod inventory unchanged", async () => {
    const r2 = new FakeR2();
    const canonical = inventoryCanonicalJson(prodInventory);
    const contentHash = await sha256Hex(canonical);
    const { ciphertextB64, encryption } = await encryptBackupPayload(canonical, KEY);
    const r2Key = "backups/bak_isolated_drill.json.enc";
    await r2.put(r2Key, ciphertextB64);

    // Isolated restore target (separate object graph — not prodInventory reference).
    const fetched = await r2.get(r2Key);
    expect(fetched).not.toBeNull();
    const plain = await decryptBackupPayload(await fetched!.text(), KEY);
    const restored = JSON.parse(plain) as BackupInventory;

    const drill = await runRestoreDrill(
      { content_hash: contentHash, encryption, status: "stored" },
      restored
    );
    expect(drill.ok).toBe(true);
    expect(drill.content_hash).toBe(contentHash);

    const restoredCounts = snapshotCounts(restored);
    expect(restoredCounts.clients).toBe(3);
    expect(restoredCounts.campaigns).toBe(5);
    expect(restoredCounts.invoices).toBe(4);
    expect(restored.schemaVersion).toBe("0010");

    // Production inventory must be bit-identical to the pre-drill snapshot.
    expect(snapshotCounts(prodInventory)).toEqual(prodCounts);
    expect(inventoryCanonicalJson(prodInventory)).toBe(canonical);

    // Cleanup isolated R2 object.
    await r2.delete(r2Key);
    expect(await r2.get(r2Key)).toBeNull();
  });

  it("rejects tampered ciphertext / wrong key without touching prod counts", async () => {
    const canonical = inventoryCanonicalJson(prodInventory);
    const contentHash = await sha256Hex(canonical);
    const { ciphertextB64 } = await encryptBackupPayload(canonical, KEY);
    await expect(decryptBackupPayload(ciphertextB64, "wrong-key-material")).rejects.toBeTruthy();
    expect(snapshotCounts(prodInventory)).toEqual(prodCounts);

    const drill = await runRestoreDrill(
      { content_hash: contentHash, encryption: "aes-256-gcm", status: "stored" },
      buildBackupInventory({
        schemaVersion: "0010",
        createdAt: prodInventory.createdAt,
        tables: [{ name: "clients", count: 999 }],
      })
    );
    expect(drill.ok).toBe(false);
    expect(drill.reason).toBe("hash_mismatch");
    expect(snapshotCounts(prodInventory)).toEqual(prodCounts);
  });
});
