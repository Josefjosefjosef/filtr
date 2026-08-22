/**
 * Vault record storage + localStorage shim.
 */
import { encryptString, decryptString } from "./iu-vault-core-v1.js";
import { readRecord, writeRecord, deleteRecord } from "./iu-vault-db-v1.js";
import { getMdk, touchActivity, getVaultState } from "./iu-vault-lock-v1.js";
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";

const ENC_PREFIX = "iu:vault:enc:v1:";
const memoryCache = new Map();
let nativeGetItem = null;
let nativeSetItem = null;
let nativeRemoveItem = null;

export function encStorageKey(storageKey) {
  return ENC_PREFIX + String(storageKey);
}

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

async function readEnvelope(storageKey) {
  const k = String(storageKey);
  let envelope = await readRecord(k);
  if (envelope) return envelope;
  captureNativeLocalStorage();
  const raw = nativeGetItem(encStorageKey(k));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export async function persistEnvelope(storageKey, envelope) {
  const k = String(storageKey);
  await writeRecord(k, envelope);
  captureNativeLocalStorage();
  nativeSetItem(encStorageKey(k), JSON.stringify(envelope));
  nativeRemoveItem(k);
}

export async function vaultGetItem(storageKey) {
  touchActivity();
  const k = String(storageKey);
  if (memoryCache.has(k)) return memoryCache.get(k);
  const envelope = await readEnvelope(k);
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
  await persistEnvelope(k, envelope);
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
  captureNativeLocalStorage();
  nativeRemoveItem(encStorageKey(k));
  nativeRemoveItem(k);
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
    captureNativeLocalStorage();
    try { nativeRemoveItem(encStorageKey(key)); } catch (_) {}
    try { nativeRemove(key); } catch (_) {}
    vaultRemoveItem(key).catch(() => {});
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
  captureNativeLocalStorage();
  const keys = new Set();
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(ENC_PREFIX)) keys.add(k.slice(ENC_PREFIX.length));
  }
  const { listRecordKeys } = await import("./iu-vault-db-v1.js");
  const idbKeys = await listRecordKeys();
  for (const k of idbKeys) keys.add(k);
  await hydrateMemoryCacheFromVault(Array.from(keys));
}

export function listEncryptedStorageKeys() {
  captureNativeLocalStorage();
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(ENC_PREFIX)) keys.push(k.slice(ENC_PREFIX.length));
  }
  return keys;
}
