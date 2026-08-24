/**
 * IndexedDB layer for vault (meta, keys, records, migration).
 */
import {
  VAULT_DB_NAME,
  VAULT_SCHEMA_VERSION,
} from "./iu-vault-core-v1.js";

const META_KEY = "vault";
const DB_VERSION = 1;

let dbPromise = null;

function openVaultDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records");
      if (!db.objectStoreNames.contains("migration")) db.createObjectStore("migration");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("VAULT_IDB_OPEN_FAILED"));
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("VAULT_IDB_TX_FAILED"));
    tx.onabort = () => reject(tx.error || new Error("VAULT_IDB_TX_ABORTED"));
  });
}

export async function readMeta() {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readonly");
    const rq = tx.objectStore("meta").get(META_KEY);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

export async function writeMeta(meta) {
  const db = await openVaultDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ ...meta, schemaVersion: VAULT_SCHEMA_VERSION }, META_KEY);
  await txDone(tx);
}

export async function readKeyRecord(id) {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readonly");
    const rq = tx.objectStore("keys").get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

export async function writeKeyRecord(id, value) {
  const db = await openVaultDb();
  const tx = db.transaction("keys", "readwrite");
  tx.objectStore("keys").put(value, id);
  await txDone(tx);
}

export async function deleteKeyRecord(id) {
  const db = await openVaultDb();
  const tx = db.transaction("keys", "readwrite");
  tx.objectStore("keys").delete(id);
  await txDone(tx);
}

export async function readRecord(storageKey) {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly");
    const rq = tx.objectStore("records").get(storageKey);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

export async function writeRecord(storageKey, envelope) {
  const db = await openVaultDb();
  const tx = db.transaction("records", "readwrite");
  tx.objectStore("records").put(envelope, storageKey);
  await txDone(tx);
}

export async function deleteRecord(storageKey) {
  const db = await openVaultDb();
  const tx = db.transaction("records", "readwrite");
  tx.objectStore("records").delete(storageKey);
  await txDone(tx);
}

export async function listRecordKeys() {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly");
    const rq = tx.objectStore("records").getAllKeys();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}

export async function readMigrationCheckpoint(id) {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("migration", "readonly");
    const rq = tx.objectStore("migration").get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

export async function writeMigrationCheckpoint(id, value) {
  const db = await openVaultDb();
  const tx = db.transaction("migration", "readwrite");
  tx.objectStore("migration").put(value, id);
  await txDone(tx);
}

export async function wipeVaultDatabase() {
  dbPromise = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(VAULT_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export async function wipeCalendarMirrorIdb() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase("iu.calendar.idb");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch (_) {
      resolve();
    }
  });
}

export async function defaultMeta() {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    securityLevel: 1,
    mindMenuUnlockMethod: "none",
    autoLockPolicy: "background",
    pinEnabled: false,
    deviceEnabled: false,
    migrationComplete: false,
    createdAt: new Date().toISOString(),
  };
}
