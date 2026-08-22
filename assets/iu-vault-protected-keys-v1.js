/**
 * Protected storage keys — derived from backup MODULE_DEFS + sensitive extras.
 */
import { MODULE_DEFS } from "./iu-user-data-backup-core.js";

/** @type {Set<string>} */
const EXACT_KEYS = new Set();
/** @type {string[]} */
const PREFIX_KEYS = [];

for (const def of MODULE_DEFS) {
  if (def.kind === "key") EXACT_KEYS.add(def.key);
  else if (def.kind === "prefix") PREFIX_KEYS.push(def.prefix);
}

// Legacy keys still read by app.js
EXACT_KEYS.add("iu.infoUzel.silverTasks.v1");
EXACT_KEYS.add("iu_moje_sluzby_banks_state_v1");
EXACT_KEYS.add("iu_moje_sluzby_bakalari_v1");

export function isProtectedStorageKey(key) {
  const k = String(key || "");
  if (!k) return false;
  if (EXACT_KEYS.has(k)) return true;
  for (let i = 0; i < PREFIX_KEYS.length; i += 1) {
    if (k.startsWith(PREFIX_KEYS[i])) return true;
  }
  return false;
}

export function listProtectedExactKeys() {
  return Array.from(EXACT_KEYS);
}

export function listProtectedPrefixKeys() {
  return PREFIX_KEYS.slice();
}

export function collectProtectedLocalStorageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k && isProtectedStorageKey(k)) keys.push(k);
  }
  return keys;
}
