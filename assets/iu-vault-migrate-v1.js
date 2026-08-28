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
  isProtectedStorageKey,
} from "./iu-vault-protected-keys-v1.js";
import { getMdk } from "./iu-vault-lock-v1.js";
import { nativeLocalStorageGet, nativeLocalStorageRemove, memoryCacheSet, getMemoryCachePlaintext, listMemoryCacheProtectedKeys, persistEnvelope, ENC_PREFIX, captureNativeLocalStorage, isEmptyShapedVaultPlaintext } from "./iu-vault-storage-v1.js";

function collectPlaintextProtectedKeys() {
  captureNativeLocalStorage();
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k || k.startsWith(ENC_PREFIX)) continue;
    if (isProtectedStorageKey(k)) keys.push(k);
  }
  return keys;
}

async function collectMigrationKeys(mdk) {
  const keys = new Set();
  for (const k of collectPlaintextProtectedKeys()) {
    if (nativeLocalStorageGet(k) != null) keys.add(k);
  }
  for (const k of listMemoryCacheProtectedKeys()) {
    if (nativeLocalStorageGet(k) != null) continue;
    const cached = getMemoryCachePlaintext(k);
    if (cached == null) continue;
    const existing = await readRecord(k);
    if (!existing) {
      keys.add(k);
      continue;
    }
    let roundtrip = null;
    try {
      roundtrip = await decryptString(mdk, k, existing);
    } catch (_) {
      roundtrip = null;
    }
    if (roundtrip !== cached) keys.add(k);
  }
  return Array.from(keys);
}

function readMigrationPlaintext(key) {
  const native = nativeLocalStorageGet(key);
  if (native != null) return native;
  return getMemoryCachePlaintext(key);
}

const MIGRATION_ID = "plaintext-to-vault-v1";

async function withMigrateLock(fn) {
  if (navigator.locks && navigator.locks.request) {
    const run = () => navigator.locks.request("iu-vault-migrate", { mode: "exclusive" }, fn);
    try {
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        return await navigator.locks.request(
          "iu-vault-migrate",
          { mode: "exclusive", signal: AbortSignal.timeout(20000) },
          fn
        );
      }
    } catch (err) {
      const name = err && err.name ? err.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        // Never block unlock/hydrate forever if a prior holder stalled.
        return fn();
      }
      throw err;
    }
    return run();
  }
  return fn();
}

export async function migratePlaintextToVault() {
  return withMigrateLock(async () => {
    const meta = await readMeta();
    const mdk = getMdk();
    if (meta && meta.l1IdbOnly && meta.migrationComplete) {
      if ((await collectMigrationKeys(mdk)).length === 0) {
        return { skipped: true, reason: "l1_idb_only" };
      }
    }
    const checkpoint = await readMigrationCheckpoint(MIGRATION_ID);
    const doneKeys = new Set(checkpoint && checkpoint.doneKeys ? checkpoint.doneKeys : []);

    const keys = await collectMigrationKeys(mdk);

    if (keys.length === 0 && meta && meta.migrationComplete) return { skipped: true };

    for (const key of keys) {
      const plaintext = readMigrationPlaintext(key);
      if (plaintext == null) {
        doneKeys.add(key);
        continue;
      }

      const existing = await readRecord(key);
      if (existing) {
        let roundtrip = null;
        try {
          roundtrip = await decryptString(mdk, key, existing);
        } catch (_) {
          roundtrip = null;
        }
        if (plaintext == null) {
          doneKeys.add(key);
          continue;
        }
        if (roundtrip !== plaintext) {
          if (isEmptyShapedVaultPlaintext(plaintext, key) && roundtrip && !isEmptyShapedVaultPlaintext(roundtrip, key)) {
            doneKeys.add(key);
            continue;
          }
          const envelope = await encryptString(mdk, key, plaintext);
          await persistEnvelope(key, envelope);
          const verify = await decryptString(mdk, key, envelope);
          if (verify !== plaintext) throw new Error(`VAULT_MIGRATE_VERIFY_FAIL:${key}`);
        }
      } else {
        const envelope = await encryptString(mdk, key, plaintext);
        await persistEnvelope(key, envelope);
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
