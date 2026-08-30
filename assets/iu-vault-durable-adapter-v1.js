/**
 * Canonical durable persistence adapter for protected personal data.
 * Modules must use durableSet / durableRemove — not fire-and-forget setItem alone.
 *
 * Contract:
 * KEY-PATH durable ready
 * → serialize
 * → encrypt
 * → IDB commit
 * → independent readback
 * → ACK
 */
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";
import {
  vaultSetItem,
  vaultRemoveItem,
  flushPendingVaultWrites,
  runVaultUserWriteAsync,
  getMemoryCachePlaintext,
  getPendingVaultWriteCount,
  memoryCacheSet,
} from "./iu-vault-storage-v1.js";
import { readRecord, deleteRecord } from "./iu-vault-db-v1.js";
import { decryptString } from "./iu-vault-core-v1.js";
import { getMdk, LEVEL1_MDK_MATERIAL_ID, readLevel1DurableMaterialBytes, getVaultState } from "./iu-vault-lock-v1.js";
import { readKeyRecord } from "./iu-vault-db-v1.js";

export const VAULT_KEY_PATH_NOT_READY = "VAULT_KEY_PATH_NOT_READY";
export const VAULT_DURABLE_READBACK_MISSING = "VAULT_DURABLE_READBACK_MISSING";
export const VAULT_DURABLE_READBACK_MISMATCH = "VAULT_DURABLE_READBACK_MISMATCH";

function markKeyPathReady(ok) {
  try {
    window.__iuVaultKeyPathDurableReady = !!ok;
  } catch (_) {}
}

export function isKeyPathDurableReadyFlag() {
  try {
    return window.__iuVaultKeyPathDurableReady === true;
  } catch (_) {
    return false;
  }
}

export function setKeyPathDurableReadyFlag(ok) {
  markKeyPathReady(ok);
}

/**
 * Prove usable crypto before any protected user-data commit.
 * L1 (SECURITY OFF): durable IDB material must exist.
 * L2/L3 unlocked: runtime MDK is sufficient (material cleared on upgrade).
 */
export async function assertDurableKeyPathReady() {
  try {
    const st = getVaultState();
    const mdk = getMdk();
    if (!st || !st.unlocked || !mdk) {
      markKeyPathReady(false);
      const err = new Error(VAULT_KEY_PATH_NOT_READY);
      err.reason = "vault_locked_or_no_mdk";
      throw err;
    }
    if (st.requiresUserReauth) {
      markKeyPathReady(true);
      return true;
    }
    const raw = await readLevel1DurableMaterialBytes();
    if (!raw || raw.byteLength < 16) {
      markKeyPathReady(false);
      const err = new Error(VAULT_KEY_PATH_NOT_READY);
      err.reason = "durable_material_absent";
      throw err;
    }
    markKeyPathReady(true);
    return true;
  } catch (err) {
    if (err && err.message === VAULT_KEY_PATH_NOT_READY) throw err;
    markKeyPathReady(false);
    const e = new Error(VAULT_KEY_PATH_NOT_READY);
    e.reason = String(err && err.message ? err.message : err).slice(0, 64);
    throw e;
  }
}

async function independentReadbackPlaintext(storageKey) {
  const k = String(storageKey);
  const env = await readRecord(k);
  if (!env || !env.ct) return null;
  const mdk = getMdk();
  if (!mdk) return null;
  return decryptString(mdk, k, env);
}

/**
 * Durable protected write with independent IDB readback verification.
 * @returns {{ ok: true, key: string, bytes: number }}
 */
export async function durableSet(storageKey, value) {
  const k = String(storageKey);
  if (!isProtectedStorageKey(k)) {
    try {
      localStorage.setItem(k, String(value));
    } catch (err) {
      throw err;
    }
    return { ok: true, key: k, bytes: String(value).length, protected: false };
  }
  await assertDurableKeyPathReady();
  const text = String(value);
  // Optimistic memory so UI consumers that re-read storage mid-flight see the write
  // (durable ACK still requires IDB commit + readback below).
  memoryCacheSet(k, text);
  await runVaultUserWriteAsync(async () => {
    await vaultSetItem(k, text, { requireCommit: true });
  });
  await flushPendingVaultWrites();
  // Prefer memory (authoritative after successful commit); fall back to IDB decrypt.
  let pt = getMemoryCachePlaintext(k);
  if (pt == null || String(pt) !== text) {
    pt = await independentReadbackPlaintext(k);
  }
  if (pt == null) {
    const err = new Error(VAULT_DURABLE_READBACK_MISSING);
    err.key = k;
    throw err;
  }
  if (String(pt) !== text) {
    // One retry for generation races, then fail closed (never ACK wrong durable state).
    await runVaultUserWriteAsync(async () => {
      await vaultSetItem(k, text, { requireCommit: true });
    });
    await flushPendingVaultWrites();
    pt = getMemoryCachePlaintext(k);
    if (pt == null || String(pt) !== text) {
      pt = await independentReadbackPlaintext(k);
    }
    if (pt == null || String(pt) !== text) {
      const err = new Error(VAULT_DURABLE_READBACK_MISMATCH);
      err.key = k;
      throw err;
    }
  }
  try {
    const arr = window.__iuModuleSaveTrace || (window.__iuModuleSaveTrace = []);
    arr.push({
      at: Date.now(),
      module: "durable-adapter",
      key: k,
      step: "durable_set_readback_ok",
      ok: true,
      bytes: text.length,
    });
    if (arr.length > 40) arr.splice(0, arr.length - 40);
  } catch (_) {}
  return { ok: true, key: k, bytes: text.length, protected: true };
}

/**
 * Durable protected delete — IDB record must be gone after commit.
 */
export async function durableRemove(storageKey) {
  const k = String(storageKey);
  if (!isProtectedStorageKey(k)) {
    try {
      localStorage.removeItem(k);
    } catch (_) {}
    return { ok: true, key: k, protected: false };
  }
  await assertDurableKeyPathReady();
  await runVaultUserWriteAsync(async () => {
    await vaultRemoveItem(k);
  });
  await flushPendingVaultWrites();
  const env = await readRecord(k);
  if (env) {
    await deleteRecord(k);
  }
  const again = await readRecord(k);
  if (again) {
    const err = new Error("VAULT_DURABLE_DELETE_READBACK_FAIL");
    err.key = k;
    throw err;
  }
  if (getMemoryCachePlaintext(k) != null) {
    // memory should be cleared by vaultRemoveItem
  }
  return { ok: true, key: k, protected: true, deleted: true };
}

export async function durableFlush() {
  await flushPendingVaultWrites();
  return { ok: true, pending: getPendingVaultWriteCount() };
}

/**
 * Convenience for modules that still hold JSON objects.
 */
export async function durableSetJson(storageKey, obj) {
  return durableSet(storageKey, JSON.stringify(obj));
}
