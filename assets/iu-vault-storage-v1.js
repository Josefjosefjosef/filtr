/**
 * Vault record storage + localStorage shim.
 */
import { encryptString, decryptString } from "./iu-vault-core-v1.js";
import { readRecord, writeRecord, deleteRecord } from "./iu-vault-db-v1.js";
import { getMdk, touchActivity, getVaultState } from "./iu-vault-lock-v1.js";
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";

const memoryCache = new Map();
let nativeGetItem = null;
let nativeSetItem = null;
let nativeRemoveItem = null;

export function captureNativeLocalStorage() {
  if (nativeGetItem) return;
  nativeGetItem = localStorage.getItem.bind(localStorage);
  nativeSetItem = localStorage.setItem.bind(localStorage);
  nativeRemoveItem = localStorage.removeItem.bind(localStorage);
}

export function nativeLocalStorageGet(key) {
  if (!nativeGetItem) captureNativeLocalStorage();
  return nativeGetItem(key);
}

export function nativeLocalStorageRemove(key) {
  if (!nativeRemoveItem) captureNativeLocalStorage();
  return nativeRemoveItem(key);
}

export async function vaultGetItem(storageKey) {
  touchActivity();
  const k = String(storageKey);
  if (memoryCache.has(k)) return memoryCache.get(k);
  const envelope = await readRecord(k);
  if (!envelope) return null;
  const mdk = getMdk();
  const text = await decryptString(mdk, k, envelope);
  memoryCache.set(k, text);
  return text;
}

export async function vaultSetItem(storageKey, value) {
  touchActivity();
  const k = String(storageKey);
  const text = String(value);
  const mdk = getMdk();
  const envelope = await encryptString(mdk, k, text);
  await writeRecord(k, envelope);
  memoryCache.set(k, text);
  try {
    window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key: k, source: "iu-vault" } }));
  } catch (_) {}
}

export async function vaultRemoveItem(storageKey) {
  touchActivity();
  const k = String(storageKey);
  memoryCache.delete(k);
  await deleteRecord(k);
  try {
    window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key: k, source: "iu-vault" } }));
  } catch (_) {}
}

export function memoryCacheSet(key, value) {
  memoryCache.set(String(key), String(value));
}

export function installLocalStorageShim() {
  if (installLocalStorageShim._done) return;
  installLocalStorageShim._done = true;
  captureNativeLocalStorage();
  const nativeGet = nativeGetItem;
  const nativeSet = nativeSetItem;
  const nativeRemove = nativeRemoveItem;

  localStorage.getItem = function shimGetItem(key) {
    if (!isProtectedStorageKey(key)) return nativeGet(key);
    const st = getVaultState();
    if (!st.unlocked) return null;
    if (memoryCache.has(key)) return memoryCache.get(key);
    return null;
  };

  localStorage.setItem = function shimSetItem(key, value) {
    if (!isProtectedStorageKey(key)) {
      nativeSet(key, value);
      return;
    }
    const st = getVaultState();
    if (!st.unlocked) throw new Error("VAULT_LOCKED");
    const text = String(value);
    memoryCache.set(String(key), text);
    vaultSetItem(key, text).catch(() => {});
    try { nativeRemove(key); } catch (_) {}
  };

  localStorage.removeItem = function shimRemoveItem(key) {
    if (!isProtectedStorageKey(key)) {
      nativeRemove(key);
      return;
    }
    memoryCache.delete(String(key));
    vaultRemoveItem(key).catch(() => {});
    try { nativeRemove(key); } catch (_) {}
  };
}

export async function hydrateMemoryCacheFromVault(keys) {
  for (const key of keys) {
    try {
      const val = await vaultGetItem(key);
      if (val != null) memoryCache.set(key, val);
    } catch (_) {}
  }
}

export async function preloadAllVaultRecords() {
  const { listRecordKeys } = await import("./iu-vault-db-v1.js");
  const keys = await listRecordKeys();
  await hydrateMemoryCacheFromVault(keys);
}
