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
let userWriteDepth = 0;
let nativeGetItem = null;
let nativeSetItem = null;
let nativeRemoveItem = null;

export function encStorageKey(storageKey) {
  return ENC_PREFIX + String(storageKey);
}

let recordDiag = null;
async function diag() {
  if (recordDiag) return recordDiag;
  try {
    const mod = await import("./iu-vault-persistence-diag-v1.js");
    recordDiag = mod.recordVaultPersistenceEvent;
    return recordDiag;
  } catch (_) {
    recordDiag = () => {};
    return recordDiag;
  }
}

function diagSync(step, detail) {
  if (recordDiag) {
    recordDiag(step, detail);
    return;
  }
  void diag().then((fn) => fn(step, detail)).catch(() => {});
}

export function getPendingVaultWriteCount() {
  return pendingWrites.size;
}

export function isPlaintextStagingPresent(storageKey) {
  captureNativeLocalStorage();
  try {
    return nativeGetItem(String(storageKey)) != null;
  } catch (_) {
    return false;
  }
}

/** True while an explicit user-initiated protected write is in flight (filters, notes, etc.). */
export function isVaultUserWriteActive() {
  if (userWriteDepth > 0) return true;
  try {
    return (window.__iuVaultUserWriteDepth || 0) > 0;
  } catch (_) {
    return false;
  }
}

export function runVaultUserWrite(fn) {
  userWriteDepth += 1;
  try {
    return fn();
  } finally {
    userWriteDepth -= 1;
  }
}

export async function runVaultUserWriteAsync(fn) {
  userWriteDepth += 1;
  try {
    return await fn();
  } finally {
    userWriteDepth -= 1;
  }
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
  // Legacy LS mirror — read-only fallback until L1 migration removes it.
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
  diagSync("06-write-start", { key: k, source: "persistEnvelope" });
  await writeRecord(k, envelope);
  captureNativeLocalStorage();
  nativeRemoveItem(k);
  // Always drop legacy LS enc mirror after authoritative IDB commit.
  // Leaving a stale LS enc while migration is incomplete creates conflict_idb_ls on next boot.
  try {
    nativeRemoveItem(encStorageKey(k));
  } catch (_) {}
  diagSync("07-write-transaction-complete", { key: k, source: "persistEnvelope" });
}

export async function vaultGetItem(storageKey) {
  touchActivity();
  const k = String(storageKey);
  if (memoryCache.has(k)) return memoryCache.get(k);
  diagSync("18-record-read", { key: k, source: "vaultGetItem" });
  const envelope = await readEnvelope(k);
  if (!envelope) return null;
  const mdk = getMdk();
  try {
    const text = await decryptString(mdk, k, envelope);
    memoryCache.set(k, text);
    diagSync("19-decrypt-success", { key: k, decryptStatus: "ok", source: "vaultGetItem" });
    return text;
  } catch (err) {
    diagSync("19-decrypt-fail", {
      key: k,
      decryptStatus: "fail",
      reason: String(err && err.message ? err.message : err).slice(0, 64),
      source: "vaultGetItem",
    });
    throw err;
  }
}

export async function vaultSetItem(storageKey, value) {
  touchActivity();
  const k = String(storageKey);
  const source = isVaultUserWriteActive() ? "user" : "module";
  diagSync("03-persist-request", { key: k, source, pendingWrites: pendingWrites.size });
  if (isVaultPersistBlocked(k)) {
    diagSync("03-persist-request", { key: k, source, writeBlocked: true, reason: "persist_blocked" });
    return;
  }
  const text = String(value);
  if (shouldBlockPostHydrateClobber(k, text)) {
    diagSync("24-overwrite-blocked", { key: k, source, writeBlocked: true, reason: "empty_clobber" });
    return;
  }
  const generation = (writeGeneration.get(k) || 0) + 1;
  writeGeneration.set(k, generation);
  let writePromise;
  writePromise = (async () => {
    if (isVaultPersistBlocked(k)) {
      diagSync("03-persist-request", { key: k, source, writeBlocked: true, reason: "persist_blocked_async" });
      return;
    }
    if (shouldBlockPostHydrateClobber(k, text)) {
      diagSync("24-overwrite-blocked", { key: k, source, writeBlocked: true, reason: "empty_clobber_async" });
      return;
    }
    if (!isVaultUserWriteActive() && looksLikeEmptyModuleReset(text, k)) {
      const existing = await readRecord(k);
      if (existing) {
        try {
          const probeMdk = getMdk();
          const prev = await decryptString(probeMdk, k, existing);
          if (prev && prev.length >= 24 && !looksLikeEmptyModuleReset(prev, k)) {
            diagSync("24-overwrite-blocked", { key: k, source, writeBlocked: true, reason: "idb_nonempty_clobber" });
            return;
          }
        } catch (_) {}
      }
    }
    const mdk = getMdk();
    if (!mdk) {
      diagSync("03-persist-request", { key: k, source, writeBlocked: true, reason: "no_mdk" });
      return;
    }
    diagSync("04-encrypt-start", { key: k, generation, source, pendingWrites: pendingWrites.size });
    const envelope = await encryptString(mdk, k, text);
    diagSync("05-encrypt-success", { key: k, generation, source });
    if (writeGeneration.get(k) !== generation) return;
    if (isVaultPersistBlocked(k)) {
      diagSync("03-persist-request", { key: k, source, writeBlocked: true, reason: "persist_blocked_pre_write" });
      return;
    }
    await persistEnvelope(k, envelope);
    if (writeGeneration.get(k) !== generation) return;
    captureNativeLocalStorage();
    try {
      nativeRemoveItem(k);
    } catch (_) {}
    memoryCache.set(k, text);
    diagSync("08-write-confirmed", { key: k, generation, source, pendingWrites: pendingWrites.size });
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

export function getMemoryCachePlaintext(storageKey) {
  const k = String(storageKey);
  return memoryCache.has(k) ? memoryCache.get(k) : null;
}

export function listMemoryCacheProtectedKeys() {
  return Array.from(memoryCache.keys()).filter((k) => isProtectedStorageKey(k));
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
    // Top-level [] is a legitimate clear-all (e.g. iu_silver_parcel_watch_v1).
    if (Array.isArray(o)) return false;
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
  if (isVaultUserWriteActive()) return false;
  const k = String(key || "");
  if (!looksLikeEmptyModuleReset(text, k)) return false;
  if (memoryCache.has(k)) {
    const prev = memoryCache.get(k) || "";
    if (prev.length >= 24 && !looksLikeEmptyModuleReset(prev, k)) return true;
  }
  try {
    if (window.__iuVaultHydrationPending && hasEncryptedRecordAtRest(k)) return true;
    const st = getVaultState();
    if (st.unlocked) return false;
  } catch (_) {}
  return false;
}

export function hasEncryptedRecordAtRest(storageKey) {
  const k = String(storageKey);
  captureNativeLocalStorage();
  try {
    if (nativeGetItem(encStorageKey(k))) return true;
  } catch (_) {}
  return false;
}

/** Authoritative check including IDB records store (async). */
export async function hasEncryptedRecordAtRestAsync(storageKey) {
  const k = String(storageKey);
  try {
    const env = await readRecord(k);
    if (env) return true;
  } catch (_) {}
  return hasEncryptedRecordAtRest(k);
}

export function isEmptyShapedVaultPlaintext(text, storageKey) {
  return looksLikeEmptyModuleReset(text, storageKey);
}

/** Block module saves while locked (ciphertext at rest) or while post-unlock hydrate is still pending. */
export function isVaultPersistBlocked(storageKey) {
  if (!isProtectedStorageKey(storageKey)) return false;
  if (isVaultUserWriteActive()) return false;
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
    const writeSource = isVaultUserWriteActive() ? "user" : "module";
    diagSync("01-user-write-request", { key: String(key), source: writeSource, pendingWrites: pendingWrites.size });
    const st = getVaultState();
    if (!st.unlocked) {
      // L1 boot race: shim is installed before ensureLevel1Mdk unlocks.
      // Only hard-block writes when the user must re-authenticate.
      if (!st.requiresUserReauth) {
        nativeSet(key, value);
        return;
      }
      diagSync("01-user-write-request", { key: String(key), source: writeSource, writeBlocked: true, reason: "vault_locked" });
      throw new Error("VAULT_LOCKED");
    }
    if (isVaultPersistBlocked(key)) {
      diagSync("01-user-write-request", { key: String(key), source: writeSource, writeBlocked: true, reason: "persist_blocked" });
    }
    if (isVaultPersistBlocked(key)) return;
    const text = String(value);
    if (shouldBlockPostHydrateClobber(String(key), text)) {
      diagSync("24-overwrite-blocked", { key: String(key), source: writeSource, writeBlocked: true, reason: "empty_clobber" });
      return;
    }
    memoryCache.set(String(key), text);
    const writePromise = vaultSetItem(key, text);
    writePromise.catch(() => {});
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
      diagSync("20-module-hydrate", { key: String(key), source: "hydrateMemoryCacheFromVault" });
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

export async function listEncryptedStorageKeysAsync() {
  const keys = new Set(listEncryptedStorageKeys());
  try {
    const { listRecordKeys } = await import("./iu-vault-db-v1.js");
    const { isProtectedStorageKey } = await import("./iu-vault-protected-keys-v1.js");
    for (const k of await listRecordKeys()) {
      if (isProtectedStorageKey(k)) keys.add(k);
    }
  } catch (_) {}
  return Array.from(keys);
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
    const isConflictArchive = String(k).indexOf("iu.vault.conflict.archive.v1:") === 0;
    if (!isProtectedStorageKey(k) && !isConflictArchive) continue;
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
        recordType = isConflictArchive ? "conflict_archive" : "encrypted_record";
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
