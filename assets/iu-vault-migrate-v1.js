/**
 * Idempotent migration from plaintext localStorage to encrypted vault records.
 */
import {
  encryptString,
  decryptString,
} from "./iu-vault-core-v1.js";
import {
  readMeta,
  writeMeta,
  writeRecord,
  readRecord,
  writeMigrationCheckpoint,
  readMigrationCheckpoint,
  wipeCalendarMirrorIdb,
} from "./iu-vault-db-v1.js";
import {
  collectProtectedLocalStorageKeys,
  isProtectedStorageKey,
} from "./iu-vault-protected-keys-v1.js";
import { getMdk } from "./iu-vault-lock-v1.js";
import { nativeLocalStorageGet, nativeLocalStorageRemove, memoryCacheSet } from "./iu-vault-storage-v1.js";

const MIGRATION_ID = "plaintext-to-vault-v1";

async function withMigrateLock(fn) {
  if (navigator.locks && navigator.locks.request) {
    return navigator.locks.request("iu-vault-migrate", { mode: "exclusive" }, fn);
  }
  return fn();
}

export async function migratePlaintextToVault() {
  return withMigrateLock(async () => {
    const meta = await readMeta();
    if (meta && meta.migrationComplete) return { skipped: true };

    const checkpoint = await readMigrationCheckpoint(MIGRATION_ID);
    const doneKeys = new Set(checkpoint && checkpoint.doneKeys ? checkpoint.doneKeys : []);

    const mdk = getMdk();
    const keys = collectProtectedLocalStorageKeys(localStorage);

    for (const key of keys) {
      if (doneKeys.has(key)) continue;
      const plaintext = nativeLocalStorageGet(key);
      if (plaintext == null) {
        doneKeys.add(key);
        continue;
      }

      const existing = await readRecord(key);
      if (existing) {
        const roundtrip = await decryptString(mdk, key, existing);
        if (roundtrip !== plaintext) throw new Error(`VAULT_MIGRATE_MISMATCH:${key}`);
      } else {
        const envelope = await encryptString(mdk, key, plaintext);
        await writeRecord(key, envelope);
        const verify = await decryptString(mdk, key, envelope);
        if (verify !== plaintext) throw new Error(`VAULT_MIGRATE_VERIFY_FAIL:${key}`);
      }

      nativeLocalStorageRemove(key);
      memoryCacheSet(key, plaintext);
      doneKeys.add(key);
      await writeMigrationCheckpoint(MIGRATION_ID, { doneKeys: Array.from(doneKeys), updatedAt: new Date().toISOString() });
    }

    await wipeCalendarMirrorIdb();

    const updated = { ...(meta || {}), migrationComplete: true, migratedAt: new Date().toISOString() };
    await writeMeta(updated);
    await writeMigrationCheckpoint(MIGRATION_ID, { doneKeys: Array.from(doneKeys), complete: true, updatedAt: new Date().toISOString() });
    return { migrated: keys.length };
  });
}

export function scanForPlaintextLeaks() {
  const leaks = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && isProtectedStorageKey(k)) leaks.push(k);
  }
  return leaks;
}
