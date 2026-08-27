/**
 * L1 IDB-only migration — safe #10103 legacy backup + LS ciphertext reconciliation.
 * Idempotent; fail-closed on ambiguous state; cleanup only after verified decrypt.
 */
import {
  decryptString,
  exportMdkRaw,
  importMdkRaw,
  b64ToBytes,
  VAULT_SCHEMA_VERSION,
} from "./iu-vault-core-v1.js";
import {
  readKeyRecord,
  writeKeyRecord,
  readRecord,
  writeRecord,
  listRecordKeys,
  readMigrationCheckpoint,
  writeMigrationCheckpoint,
  readMeta,
  writeMeta,
} from "./iu-vault-db-v1.js";
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";

const ENC_PREFIX = "iu:vault:enc:v1:";
const LEVEL1_MDK_BACKUP_KEY = "iu:vault:mdk-level1-backup:v1";

function encStorageKey(storageKey) {
  return ENC_PREFIX + String(storageKey);
}

function nativeLocalStorageGet(key) {
  try {
    return localStorage.getItem(String(key));
  } catch (_) {
    return null;
  }
}

function nativeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(String(key));
  } catch (_) {}
}

export const L1_IDB_MIGRATION_ID = "l1-idb-only-v1";

const PHASE_COMPLETE = "complete";
const PHASE_FAIL_CLOSED = "fail_closed";

function isVaultEnvelope(value) {
  return !!(value && value.v === VAULT_SCHEMA_VERSION && value.ct);
}

async function withMigrateLock(fn) {
  if (navigator.locks && navigator.locks.request) {
    return navigator.locks.request("iu-vault-l1-migrate", { mode: "exclusive" }, fn);
  }
  return fn();
}

function readLegacyLsEnvelope(storageKey) {
  const raw = nativeLocalStorageGet(encStorageKey(storageKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isVaultEnvelope(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export async function listLegacyLsEncKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ENC_PREFIX)) {
        const bare = k.slice(ENC_PREFIX.length);
        if (isProtectedStorageKey(bare)) keys.push(bare);
      }
    }
  } catch (_) {}
  return keys;
}

export async function collectProtectedRecordKeys() {
  const keys = new Set();
  try {
    for (const k of await listRecordKeys()) {
      if (isProtectedStorageKey(k)) keys.add(k);
    }
  } catch (_) {}
  for (const k of await listLegacyLsEncKeys()) keys.add(k);
  return Array.from(keys);
}

async function tryDecryptEnvelope(mdk, storageKey, envelope) {
  if (!mdk || !envelope || !isVaultEnvelope(envelope)) return { ok: false, reason: "bad_input" };
  try {
    const pt = await decryptString(mdk, storageKey, envelope);
    return { ok: true, plaintext: pt };
  } catch (err) {
    return { ok: false, reason: String(err && err.name ? err.name : err.message || err).slice(0, 64) };
  }
}

async function mdkDecryptsAnyRecord(mdk, keys) {
  if (!mdk || !keys.length) return { ok: false, tested: 0 };
  for (const key of keys) {
    const idbEnv = await readRecord(key);
    const lsEnv = readLegacyLsEnvelope(key);
    const env = idbEnv || lsEnv;
    if (!env) continue;
    const res = await tryDecryptEnvelope(mdk, key, env);
    if (res.ok) return { ok: true, key, plaintext: res.plaintext };
  }
  return { ok: false, tested: keys.length };
}

async function readLegacyBackupMdk() {
  try {
    const b64 = localStorage.getItem(LEVEL1_MDK_BACKUP_KEY);
    if (!b64) return null;
    return await importMdkRaw(b64ToBytes(b64));
  } catch (_) {
    return null;
  }
}

async function resolveValidMdk(recordKeys, checkpoint) {
  if (checkpoint && checkpoint.resolvedMdk === "idb" && checkpoint.phase !== PHASE_FAIL_CLOSED) {
    const rec = await readKeyRecord("mdk:level1");
    if (rec && rec.mdk) {
      const test = await mdkDecryptsAnyRecord(rec.mdk, recordKeys);
      if (test.ok || recordKeys.length === 0) return { mdk: rec.mdk, source: "idb_checkpoint" };
    }
  }

  const idbRec = await readKeyRecord("mdk:level1");
  if (idbRec && idbRec.mdk) {
    const test = await mdkDecryptsAnyRecord(idbRec.mdk, recordKeys);
    if (test.ok || recordKeys.length === 0) return { mdk: idbRec.mdk, source: "idb" };
  }

  const backupMdk = await readLegacyBackupMdk();
  if (backupMdk) {
    const test = await mdkDecryptsAnyRecord(backupMdk, recordKeys);
    if (test.ok) return { mdk: backupMdk, source: "legacy_backup" };
  }

  if (recordKeys.length > 0 || localStorage.getItem(LEVEL1_MDK_BACKUP_KEY)) {
    return { failClosed: true, reason: "no_working_mdk" };
  }
  return { mdk: null, source: "none" };
}

async function persistNonExtractableMdk(mdk, source) {
  let finalMdk = mdk;
  try {
    const raw = await exportMdkRaw(mdk);
    finalMdk = await importMdkRaw(raw);
  } catch (_) {
    finalMdk = mdk;
  }
  const rec = {
    type: "level1",
    mdk: finalMdk,
    createdAt: new Date().toISOString(),
    migratedFrom: source || "l1-idb-only",
    extractable: false,
  };
  await writeKeyRecord("mdk:level1", rec);
  return finalMdk;
}

async function reconcileRecordToIdb(storageKey, mdk, checkpoint) {
  const done = checkpoint && Array.isArray(checkpoint.recordsDone) ? new Set(checkpoint.recordsDone) : new Set();
  if (done.has(storageKey)) {
    const idb = await readRecord(storageKey);
    if (idb) return { ok: true, skipped: true };
  }

  const idbEnv = await readRecord(storageKey);
  const lsEnv = readLegacyLsEnvelope(storageKey);

  if (idbEnv && lsEnv) {
    const idbDec = await tryDecryptEnvelope(mdk, storageKey, idbEnv);
    const lsDec = await tryDecryptEnvelope(mdk, storageKey, lsEnv);
    if (idbDec.ok && lsDec.ok) {
      if (idbDec.plaintext !== lsDec.plaintext) {
        return { ok: false, failClosed: true, reason: "conflict_idb_ls", key: storageKey };
      }
      await writeRecord(storageKey, idbEnv);
      return { ok: true, source: "idb_authoritative" };
    }
    if (lsDec.ok && !idbDec.ok) {
      await writeRecord(storageKey, lsEnv);
      const verify = await tryDecryptEnvelope(mdk, storageKey, lsEnv);
      if (!verify.ok) return { ok: false, failClosed: true, reason: "ls_to_idb_verify_fail", key: storageKey };
      return { ok: true, source: "ls_migrated" };
    }
    if (idbDec.ok) {
      await writeRecord(storageKey, idbEnv);
      return { ok: true, source: "idb_only" };
    }
    return { ok: false, failClosed: true, reason: "both_decrypt_fail", key: storageKey };
  }

  if (idbEnv) {
    const idbDec = await tryDecryptEnvelope(mdk, storageKey, idbEnv);
    if (!idbDec.ok) return { ok: false, failClosed: true, reason: "idb_decrypt_fail", key: storageKey };
    return { ok: true, source: "idb_existing" };
  }

  if (lsEnv) {
    await writeRecord(storageKey, lsEnv);
    const verify = await tryDecryptEnvelope(mdk, storageKey, lsEnv);
    if (!verify.ok) return { ok: false, failClosed: true, reason: "ls_migrate_verify_fail", key: storageKey };
    return { ok: true, source: "ls_only_migrated" };
  }

  return { ok: true, skipped: true, reason: "no_envelope" };
}

async function verifyAllRecords(mdk, recordKeys) {
  for (const key of recordKeys) {
    const env = await readRecord(key);
    if (!env) {
      const ls = readLegacyLsEnvelope(key);
      if (ls) return { ok: false, reason: "idb_missing_after_reconcile", key };
      continue;
    }
    const dec = await tryDecryptEnvelope(mdk, key, env);
    if (!dec.ok) return { ok: false, reason: dec.reason || "verify_decrypt_fail", key };
  }
  return { ok: true };
}

async function verifyMdkFromIdb(mdk, recordKeys) {
  const reread = await readKeyRecord("mdk:level1");
  if (!reread || !reread.mdk) return { ok: false, reason: "idb_key_missing" };
  const sample = recordKeys.length ? recordKeys.slice(0, Math.min(3, recordKeys.length)) : [];
  for (const key of sample) {
    const env = await readRecord(key);
    if (!env) continue;
    const a = await tryDecryptEnvelope(mdk, key, env);
    const b = await tryDecryptEnvelope(reread.mdk, key, env);
    if (a.ok !== b.ok || (a.ok && a.plaintext !== b.plaintext)) {
      return { ok: false, reason: "cold_mdk_mismatch", key };
    }
  }
  return { ok: true, mdk: reread.mdk };
}

function removeLegacyLsEncMirror(storageKey) {
  nativeLocalStorageRemove(encStorageKey(storageKey));
}

function removeLegacyBackup() {
  try {
    localStorage.removeItem(LEVEL1_MDK_BACKUP_KEY);
  } catch (_) {}
}

export async function isL1IdbMigrationComplete() {
  const cp = await readMigrationCheckpoint(L1_IDB_MIGRATION_ID);
  return !!(cp && cp.phase === PHASE_COMPLETE);
}

export async function migrateL1ToIdbOnly(options = {}) {
  return withMigrateLock(async () => {
    let checkpoint = (await readMigrationCheckpoint(L1_IDB_MIGRATION_ID)) || { phase: "start", recordsDone: [] };
    if (checkpoint.phase === PHASE_COMPLETE) {
      return { ok: true, complete: true, skipped: true };
    }
    if (checkpoint.phase === PHASE_FAIL_CLOSED && !options.retry) {
      return { ok: false, failClosed: true, reason: checkpoint.reason || "prior_fail_closed" };
    }

    const recordKeys = await collectProtectedRecordKeys();
    const hasBackup = !!localStorage.getItem(LEVEL1_MDK_BACKUP_KEY);
    const hasRecords = recordKeys.length > 0;

    if (!hasRecords && !hasBackup) {
      checkpoint = { phase: PHASE_COMPLETE, recordsDone: [], updatedAt: new Date().toISOString(), emptyVault: true };
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
      const meta = await readMeta();
      if (meta) {
        meta.l1IdbOnly = true;
        meta.l1IdbMigratedAt = new Date().toISOString();
        await writeMeta(meta);
      }
      return { ok: true, complete: true, emptyVault: true };
    }

    const resolved = await resolveValidMdk(recordKeys, checkpoint);
    if (resolved.failClosed) {
      checkpoint = { phase: PHASE_FAIL_CLOSED, reason: resolved.reason, updatedAt: new Date().toISOString() };
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
      return { ok: false, failClosed: true, reason: resolved.reason };
    }

    let workingMdk = resolved.mdk;
    checkpoint.phase = "mdk_resolved";
    checkpoint.resolvedMdk = resolved.source;
    checkpoint.updatedAt = new Date().toISOString();
    await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);

    const recordsDone = Array.isArray(checkpoint.recordsDone) ? checkpoint.recordsDone.slice() : [];
    for (const key of recordKeys) {
      if (recordsDone.includes(key)) continue;
      const rec = await reconcileRecordToIdb(key, workingMdk, checkpoint);
      if (rec.failClosed) {
        checkpoint = { phase: PHASE_FAIL_CLOSED, reason: rec.reason, key: rec.key, updatedAt: new Date().toISOString(), recordsDone };
        await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
        return { ok: false, failClosed: true, reason: rec.reason, key: rec.key };
      }
      if (rec.ok && !rec.skipped) recordsDone.push(key);
      checkpoint.recordsDone = recordsDone;
      checkpoint.phase = "records_reconciled";
      checkpoint.updatedAt = new Date().toISOString();
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
    }

    const verifyRec = await verifyAllRecords(workingMdk, recordKeys);
    if (!verifyRec.ok) {
      checkpoint = { phase: PHASE_FAIL_CLOSED, reason: verifyRec.reason, key: verifyRec.key, updatedAt: new Date().toISOString(), recordsDone };
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
      return { ok: false, failClosed: true, reason: verifyRec.reason, key: verifyRec.key };
    }

    checkpoint.phase = "verified_pre_mdk_persist";
    await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);

    try {
      workingMdk = await persistNonExtractableMdk(workingMdk, resolved.source);
    } catch (err) {
      checkpoint = { phase: PHASE_FAIL_CLOSED, reason: "mdk_persist_fail", updatedAt: new Date().toISOString(), recordsDone };
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
      return { ok: false, failClosed: true, reason: String(err && err.message ? err.message : err) };
    }

    checkpoint.phase = "mdk_persisted";
    await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);

    const cold = await verifyMdkFromIdb(workingMdk, recordKeys);
    if (!cold.ok) {
      checkpoint = { phase: PHASE_FAIL_CLOSED, reason: cold.reason, updatedAt: new Date().toISOString(), recordsDone };
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
      return { ok: false, failClosed: true, reason: cold.reason };
    }
    workingMdk = cold.mdk || workingMdk;

    const verifyFinal = await verifyAllRecords(workingMdk, recordKeys);
    if (!verifyFinal.ok) {
      checkpoint = { phase: PHASE_FAIL_CLOSED, reason: verifyFinal.reason, updatedAt: new Date().toISOString(), recordsDone };
      await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);
      return { ok: false, failClosed: true, reason: verifyFinal.reason };
    }

    checkpoint.phase = "cleanup_pending";
    await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);

    if (!options.skipCleanup) {
      for (const key of recordKeys) {
        removeLegacyLsEncMirror(key);
      }
      removeLegacyBackup();
    }

    checkpoint.phase = PHASE_COMPLETE;
    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.cleanupDone = !options.skipCleanup;
    await writeMigrationCheckpoint(L1_IDB_MIGRATION_ID, checkpoint);

    const meta = await readMeta();
    if (meta) {
      meta.l1IdbOnly = true;
      meta.l1IdbMigratedAt = new Date().toISOString();
      await writeMeta(meta);
    }

    return { ok: true, complete: true, mdk: workingMdk, recordCount: recordKeys.length };
  });
}

export async function hasProtectedVaultEvidence() {
  const keys = await collectProtectedRecordKeys();
  if (keys.length > 0) return true;
  if (localStorage.getItem(LEVEL1_MDK_BACKUP_KEY)) return true;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && isProtectedStorageKey(k) && !k.startsWith(ENC_PREFIX)) {
        const v = nativeLocalStorageGet(k);
        if (v != null && String(v).trim() !== "") return true;
      }
    }
  } catch (_) {}
  return false;
}
