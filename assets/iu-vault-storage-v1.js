/**
 * Vault record storage + localStorage shim.
 */
import { encryptString, decryptString, VAULT_SCHEMA_VERSION } from "./iu-vault-core-v1.js";
import { readRecord, writeRecord, deleteRecord } from "./iu-vault-db-v1.js";
import { getMdk, touchActivity, getVaultState } from "./iu-vault-lock-v1.js";
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";

export const ENC_PREFIX = "iu:vault:enc:v1:";
const memoryCache = new Map();
const writeGeneration = new Map();
const pendingWrites = new Set();
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
  captureNativeLocalStorage();
  nativeSetItem(encStorageKey(k), JSON.stringify(envelope));
  nativeRemoveItem(k);
  await writeRecord(k, envelope);
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
  if (isVaultPersistBlocked(k)) return;
  const text = String(value);
  if (shouldBlockPostHydrateClobber(k, text)) return;
  const generation = (writeGeneration.get(k) || 0) + 1;
  writeGeneration.set(k, generation);
  let writePromise;
  writePromise = (async () => {
    if (isVaultPersistBlocked(k)) return;
    if (shouldBlockPostHydrateClobber(k, text)) return;
    const mdk = getMdk();
    if (!mdk) return;
    const envelope = await encryptString(mdk, k, text);
    if (writeGeneration.get(k) !== generation) return;
    if (isVaultPersistBlocked(k)) return;
    await persistEnvelope(k, envelope);
    if (writeGeneration.get(k) !== generation) return;
    memoryCache.set(k, text);
    try {
      window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key: k, source: "iu-vault" } }));
    } catch (_) {}
  })();
  pendingWrites.add(writePromise);
  try {
    await writePromise;
  } finally {
    pendingWrites.delete(writePromise);
  }
}

export async function flushPendingVaultWrites() {
  const pending = Array.from(pendingWrites);
  if (!pending.length) return;
  await Promise.all(pending.map((p) => p.catch(() => {})));
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

export function clearVaultMemoryCache() {
  memoryCache.clear();
  writeGeneration.clear();
}

export function notifyVaultMemoryHydrated() {
  try {
    window.__iuVaultHydratedAt = Date.now();
  } catch (_) {}
  for (const key of memoryCache.keys()) {
    try {
      window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key, source: "iu-vault-hydrate" } }));
    } catch (_) {}
  }
}

/**
 * Mobile/BFCache: modules often re-init empty defaults right after unlock and
 * clobber hydrated ciphertext. Block only empty/default-shaped overwrites
 * briefly after hydrate when cache already holds substance.
 */
function emptyArr(a) {
  return !Array.isArray(a) || a.length === 0;
}

function looksLikeEmptyPrefsReset(o) {
  if (!o || typeof o !== "object") return false;
  if (!("sections" in o) && !("feedFilter" in o) && !("homeObec" in o) && !("sourceGroups" in o)) {
    return false;
  }
  const feedEmpty =
    o.feedFilter == null ||
    (typeof o.feedFilter === "object" && !Array.isArray(o.feedFilter) && Object.keys(o.feedFilter).length === 0);
  return (
    emptyArr(o.sections) &&
    emptyArr(o.sourceGroups) &&
    emptyArr(o.sourceIds) &&
    emptyArr(o.lanes) &&
    emptyArr(o.localities) &&
    !String(o.homeKraj || "").trim() &&
    !String(o.homeOkres || "").trim() &&
    !String(o.homeObec || "").trim() &&
    !String(o.localityQuery || "").trim() &&
    feedEmpty
  );
}

function looksLikeEmptyModuleReset(text, storageKey) {
  const key = String(storageKey || "");
  try {
    const o = JSON.parse(String(text || ""));
    if (Array.isArray(o) && o.length === 0) return true;
    if (!o || typeof o !== "object") return false;
    if (Array.isArray(o.notes) && o.notes.length === 0) return true;
    if (Array.isArray(o.tasks) && o.tasks.length === 0) return true;
    if (Array.isArray(o.events) && o.events.length === 0) return true;
    if (Array.isArray(o.profiles) && o.profiles.length === 0) return true;
    if (Array.isArray(o.buttons) && o.buttons.length === 0) return true;
    if (Array.isArray(o.topics) && o.topics.length === 0) return true;
    if (Array.isArray(o.views) && o.views.length === 0) return true;
    if (looksLikeEmptyPrefsReset(o)) return true;
    if (Array.isArray(o.items)) {
      // Empty items[] is a legitimate clear-all for parcels/shopping/etc.
      // Only mailbox bootstrap uses empty/placeholder items as a hostile reset.
      if (o.items.length === 0) {
        return key === "iu_mailboxes_v1";
      }
      const placeholder = (label) => {
        const s = String(label || "").trim();
        if (!s) return true;
        if (s === "Nastavit e-mail") return true;
        if (/^Schránka\s+\d+$/i.test(s)) return true;
        if (/^Např\.:/i.test(s)) return true;
        return false;
      };
      const allPlaceholder = o.items.every((it) => placeholder(it && it.label) && !String((it && it.url) || "").trim());
      if (allPlaceholder) return true;
    }
    return false;
  } catch (_) {
    return String(text || "").trim() === "" || String(text || "").trim() === "{}";
  }
}

/**
 * Mobile/PWA: modules often re-init empty defaults long after unlock (>4s).
 * Permanently block empty/default-shaped overwrites when cache already holds substance.
 * Wipe uses removeItem / DB wipe — not empty setItem.
 */
function shouldBlockPostHydrateClobber(key, text) {
  const k = String(key || "");
  if (!looksLikeEmptyModuleReset(text, k)) return false;
  if (memoryCache.has(k)) {
    const prev = memoryCache.get(k) || "";
    if (prev.length >= 24 && !looksLikeEmptyModuleReset(prev, k)) return true;
  }
  try {
    if (window.__iuVaultHydrationPending && hasEncryptedRecordAtRest(k)) return true;
  } catch (_) {}
  return false;
}

export function hasEncryptedRecordAtRest(storageKey) {
  const k = String(storageKey);
  captureNativeLocalStorage();
  try {
    return !!nativeGetItem(encStorageKey(k));
  } catch (_) {
    return false;
  }
}

/** Block module saves while locked (ciphertext at rest) or while post-unlock hydrate is still pending. */
export function isVaultPersistBlocked(storageKey) {
  if (!isProtectedStorageKey(storageKey)) return false;
  try {
    if (window.__iuVaultHydrationPending) return true;
  } catch (_) {}
  const st = getVaultState();
  if (st.unlocked) return false;
  return hasEncryptedRecordAtRest(storageKey);
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
    if (isVaultPersistBlocked(key)) return;
    const text = String(value);
    if (shouldBlockPostHydrateClobber(String(key), text)) return;
    memoryCache.set(String(key), text);
    const writePromise = vaultSetItem(key, text);
    writePromise.catch(() => {});
    try { nativeRemove(key); } catch (_) {}
    return writePromise;
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

function isVaultEnvelope(value) {
  return !!(value && value.v === VAULT_SCHEMA_VERSION && value.ct);
}

function rotateFailError(storageKey, phase, err, recordType) {
  const name = err && err.name ? String(err.name) : "";
  const msg = String(err && err.message ? err.message : err)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 96);
  const type = recordType ? `:recordType:${recordType}` : "";
  return new Error(`VAULT_ROTATE_FAIL:${storageKey}:${phase}:${name || "Error"}:${msg}${type}`);
}

/** Re-encrypt all vault records when rotating MDK (e.g. PIN / L2 setup). */
export async function rotateVaultMdk(oldMdk, newMdk) {
  const { listRecordKeys, readRecord } = await import("./iu-vault-db-v1.js");
  const keys = new Set(await listRecordKeys());
  captureNativeLocalStorage();
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(ENC_PREFIX)) {
      keys.add(k.slice(ENC_PREFIX.length));
      continue;
    }
    if (isProtectedStorageKey(k)) keys.add(k);
  }
  for (const k of memoryCache.keys()) {
    keys.add(k);
  }
  for (const k of keys) {
    if (!isProtectedStorageKey(k)) continue;
    let pt = null;
    let recordType = "unknown";
    if (memoryCache.has(k)) {
      pt = memoryCache.get(k);
      recordType = "memory_cache";
    }
    if (pt == null) {
      let envelope = null;
      const rawEnc = nativeGetItem(encStorageKey(k));
      if (rawEnc) {
        try {
          envelope = JSON.parse(rawEnc);
        } catch (_) {
          envelope = null;
        }
      }
      if (!envelope) {
        envelope = await readRecord(k);
      }
      if (!envelope) {
        captureNativeLocalStorage();
        const nativePlain = nativeGetItem(k);
        if (nativePlain != null) {
          pt = nativePlain;
          recordType = "legacy_plaintext_only";
        } else {
          continue;
        }
      } else if (!isVaultEnvelope(envelope)) {
        continue;
      } else {
        recordType = "encrypted_record";
        try {
          pt = await decryptString(oldMdk, k, envelope);
        } catch (err) {
          captureNativeLocalStorage();
          const nativePlain = nativeGetItem(k);
          if (nativePlain != null) {
            pt = nativePlain;
            recordType = "legacy_plaintext_fallback";
          } else {
            continue;
          }
        }
      }
    }
    let newEnv = null;
    try {
      newEnv = await encryptString(newMdk, k, pt);
    } catch (err) {
      throw rotateFailError(k, "encrypt", err, recordType);
    }
    try {
      await persistEnvelope(k, newEnv);
    } catch (err) {
      throw rotateFailError(k, "persist", err, recordType);
    }
    memoryCache.set(k, pt);
  }
}
