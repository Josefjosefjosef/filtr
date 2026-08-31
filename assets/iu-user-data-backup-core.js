/**
 * InfoUzel.cz — user data backup core (export / import / validate).
 * Browser UI and Node guards import this module.
 *
 * New exports (v2): AES-256-GCM envelope + PBKDF2-SHA256 password.
 * Legacy plaintext v1 imports remain supported (read-only path).
 */
export const BACKUP_FORMAT = "infouzel-backup";
/** Outer envelope version for newly created encrypted backups. */
export const BACKUP_VERSION = 2;
/** Inner plaintext payload schema version (also legacy file version). */
export const BACKUP_PAYLOAD_VERSION = 1;
export const BACKUP_PBKDF2_ITERATIONS = 310000;
export const BACKUP_SALT_BYTES = 16;
export const BACKUP_IV_BYTES = 12;
export const BACKUP_PASSWORD_MIN_LEN = 8;
/** Primary extension for newly exported backups (JSON payload). */
export const BACKUP_FILE_EXT = ".json";
/** Legacy/custom extension still accepted on import. */
export const BACKUP_FILE_EXT_LEGACY = ".iubackup";
export const BACKUP_FILE_ACCEPT = ".json,.iubackup,application/json,text/plain,text/json";
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_JSON_DEPTH = 32;
export const MAX_STRING_LEN = 5 * 1024 * 1024;
export const LAST_EXPORT_KEY = "iu:user-data-backup:last-export-at:v1";

export const CALENDAR_IDB = Object.freeze({
  dbName: "iu.calendar.idb",
  storeName: "meta",
  recordKey: "iu.calendar.store.v1",
  localStorageKey: "iu.calendar.store.v1",
});

/** @typedef {{ id: string, label: string, kind: "key", key: string, schemaVersion?: number } | { id: string, label: string, kind: "prefix", prefix: string, schemaVersion?: number }} ModuleDef */

/** @type {ModuleDef[]} */
export const MODULE_DEFS = Object.freeze([
  { id: "notes", label: "Poznámky", kind: "key", key: "iu.notes.store.v1", schemaVersion: 1 },
  { id: "tasks", label: "Úkoly", kind: "key", key: "iu.tasks.mvp.v1", schemaVersion: 1 },
  { id: "calendar", label: "Kalendář", kind: "key", key: CALENDAR_IDB.localStorageKey, schemaVersion: 1 },
  { id: "invoice_form", label: "Faktury — rozpracovaný formulář", kind: "key", key: "iu_invoice_form_state_v1", schemaVersion: 1 },
  { id: "invoice_recipients", label: "Faktury — odběratelé", kind: "key", key: "iu_invoice_recipients_v1", schemaVersion: 1 },
  { id: "invoice_suppliers", label: "Faktury — dodavatelé", kind: "key", key: "iu_invoice_suppliers_v1", schemaVersion: 1 },
  { id: "invoice_counter", label: "Faktury — čítač", kind: "key", key: "iu_invoice_counter_year_v1", schemaVersion: 1 },
  { id: "datovka", label: "Datové schránky", kind: "key", key: "infouzel_datovka_profiles_v1", schemaVersion: 1 },
  { id: "mailboxes", label: "E-mailové schránky", kind: "key", key: "iu_mailboxes_v1", schemaVersion: 1 },
  { id: "quicktools", label: "MindMenu a vlastní tlačítka", kind: "key", key: "infouzel_quicktools", schemaVersion: 2 },
  { id: "saved_articles", label: "Uložené články", kind: "key", key: "iuSavedArticles", schemaVersion: 1 },
  { id: "hidden_articles", label: "Skryté články", kind: "key", key: "iuHiddenArticles", schemaVersion: 1 },
  { id: "followed_topics", label: "Sledovaná témata", kind: "key", key: "iuFollowedTopics", schemaVersion: 1 },
  { id: "read_articles", label: "Přečtené články", kind: "key", key: "iuReadArticles_v1", schemaVersion: 1 },
  { id: "user_address", label: "Silver — adresa", kind: "key", key: "iu_user_address", schemaVersion: 1 },
  { id: "user_address_explicit", label: "Silver — adresa (explicitní)", kind: "key", key: "iu_user_address_explicit.v1", schemaVersion: 1 },
  { id: "silver_salutation", label: "Silver — oslovení", kind: "key", key: "iuSilver.salutationPreference.v1", schemaVersion: 1 },
  { id: "parcel_watch", label: "Silver — sledování zásilek", kind: "key", key: "iu_silver_parcel_watch_v1", schemaVersion: 1 },
  { id: "section_notes_legacy", label: "Sekční poznámky (legacy)", kind: "key", key: "iu_section_notes_v1", schemaVersion: 1 },
  { id: "section_notes", label: "Sekční poznámky", kind: "prefix", prefix: "iu_notes_v1_", schemaVersion: 1 },
  { id: "translator_notes", label: "Překladač — poznámky", kind: "key", key: "iu:translator:notes", schemaVersion: 1 },
  { id: "banks", label: "Internetové bankovnictví", kind: "key", key: "iuUserBanks", schemaVersion: 1 },
  { id: "bakalari", label: "Bakaláři", kind: "key", key: "iu_bakalari_profiles", schemaVersion: 1 },
  { id: "health_insurance", label: "Zdravotní pojištění", kind: "key", key: "iu_health_insurance_v2", schemaVersion: 1 },
  { id: "shopping_list", label: "Nákupní seznam", kind: "key", key: "iuShoppingLastListV1", schemaVersion: 1 },
  { id: "shopping_address", label: "Doručovací adresa", kind: "key", key: "iuShoppingDeliveryAddressV1", schemaVersion: 1 },
  { id: "preferred_urls", label: "Preferované URL", kind: "key", key: "iu.preferredUrls", schemaVersion: 1 },
  { id: "desktop_homecards", label: "Pořadí karet na ploše", kind: "key", key: "iu_desktop_homecards_order_v1", schemaVersion: 1 },
  { id: "weather_mode", label: "Počasí — režim polohy", kind: "key", key: "iu_location_mode", schemaVersion: 1 },
  { id: "manual_location", label: "Počasí — ruční poloha", kind: "key", key: "iu_manual_location", schemaVersion: 1 },
  { id: "weather_gps", label: "Počasí — GPS volba", kind: "key", key: "iuWeatherGpsSelectedV1", schemaVersion: 1 },
  { id: "weather_city", label: "Počasí — město", kind: "key", key: "iuWeatherCity", schemaVersion: 1 },
  { id: "weather_city_pin", label: "Počasí — připnuté město", kind: "key", key: "iuWeatherCityPinned", schemaVersion: 1 },
  { id: "weather_city_selected", label: "Počasí — vybrané město", kind: "key", key: "iuWeatherCitySelectedV1", schemaVersion: 1 },
  { id: "weather_persist", label: "Počasí — uložený stav", kind: "key", key: "iuWeatherPersistedStateV1", schemaVersion: 1 },
  { id: "video_seen", label: "Videa — shlédnuté", kind: "key", key: "iu_video_seen_v1", schemaVersion: 1 },
  { id: "rail_bg", label: "Vzhled — pozadí lišty", kind: "key", key: "iuRailBg", schemaVersion: 1 },
  { id: "rail_btn_bg", label: "Vzhled — tlačítka lišty (pozadí)", kind: "key", key: "iuRailBtnBg", schemaVersion: 1 },
  { id: "rail_btn_fg", label: "Vzhled — tlačítka lišty (text)", kind: "key", key: "iuRailBtnFg", schemaVersion: 1 },
  { id: "info_prefs", label: "Info systém — filtry (Doprava/ČHMÚ/obce)", kind: "key", key: "iu.infoEvents.prefs.v1", schemaVersion: 6 },
  { id: "info_views", label: "Info systém — uložené pohledy", kind: "key", key: "iu.infoEvents.views.v1", schemaVersion: 6 },
  { id: "info_read", label: "Info systém — přečtené", kind: "key", key: "iu.infoEvents.read.v1", schemaVersion: 6 },
  { id: "info_saved", label: "Info systém — uložené", kind: "key", key: "iu.infoEvents.saved.v1", schemaVersion: 6 },
  { id: "info_hidden", label: "Info systém — skryté", kind: "key", key: "iu.infoEvents.hidden.v1", schemaVersion: 6 },
  { id: "info_view_baseline", label: "Info systém — baseline pohled", kind: "key", key: "iu.infoEvents.viewBaseline.v1", schemaVersion: 6 },
]);

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * @param {unknown} val
 * @param {number} depth
 */
export function assertSafeJsonValue(val, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new Error("BACKUP_DEPTH_EXCEEDED");
  if (val === null || typeof val !== "object") {
    if (typeof val === "string" && val.length > MAX_STRING_LEN) throw new Error("BACKUP_STRING_TOO_LONG");
    return;
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i += 1) assertSafeJsonValue(val[i], depth + 1);
    return;
  }
  for (const key of Object.keys(val)) {
    if (UNSAFE_KEYS.has(key)) throw new Error("BACKUP_UNSAFE_KEY");
    assertSafeJsonValue(val[key], depth + 1);
  }
}

/**
 * @param {string} raw
 */
export function normalizeBackupText(raw) {
  if (typeof raw !== "string") throw new Error("BACKUP_INVALID");
  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trim();
}

/**
 * @param {string | null | undefined} name
 */
export function isAcceptedBackupFilename(name) {
  const lower = String(name || "").trim().toLowerCase();
  if (!lower) return true;
  return lower.endsWith(BACKUP_FILE_EXT) || lower.endsWith(BACKUP_FILE_EXT_LEGACY);
}

/**
 * @param {Blob} file
 */
export async function readBackupFileText(file) {
  if (!file) throw new Error("BACKUP_INVALID");
  const size = typeof file.size === "number" ? file.size : 0;
  if (size > MAX_IMPORT_BYTES) throw new Error("BACKUP_TOO_LARGE");
  let text = "";
  try {
    if (typeof file.text === "function") {
      text = await file.text();
    } else {
      const buf = await file.arrayBuffer();
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
  } catch {
    throw new Error("BACKUP_READ_FAILED");
  }
  if (text.length > MAX_IMPORT_BYTES) throw new Error("BACKUP_TOO_LARGE");
  return normalizeBackupText(text);
}

/**
 * @param {string} raw
 */
export function parseBackupJson(raw) {
  const text = normalizeBackupText(raw);
  if (text.length > MAX_IMPORT_BYTES) throw new Error("BACKUP_TOO_LARGE");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("BACKUP_INVALID_JSON");
  }
  assertSafeJsonValue(parsed, 0);
  return parsed;
}

/**
 * @param {ReturnType<typeof validateBackupStructure>} backup
 */
export function buildIntegrityPayload(backup) {
  return {
    format: backup.format,
    backupVersion: backup.backupVersion,
    createdAt: backup.createdAt,
    appVersion: typeof backup.appVersion === "string" ? backup.appVersion : "",
    encrypted: typeof backup.encrypted === "boolean" ? backup.encrypted : false,
    modules: backup.modules,
  };
}

/**
 * @param {Record<string, string>} entries
 */
export function countModuleEntries(entries) {
  return Object.keys(entries || {}).length;
}

/**
 * @param {string | null | undefined} raw
 */
export function countFromRawValue(raw) {
  if (raw == null || raw === "") return 0;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.tasks)) return parsed.tasks.length;
      if (Array.isArray(parsed.events)) return parsed.events.length;
      if (Array.isArray(parsed.notes)) return parsed.notes.length;
      if (Array.isArray(parsed.items)) return parsed.items.length;
      if (Array.isArray(parsed.profiles)) return parsed.profiles.length;
      return Object.keys(parsed).length;
    }
  } catch {
    return 1;
  }
  return 1;
}

/**
 * @typedef {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void, keys: () => string[] }} StorageAdapter
 * @typedef {{ getCalendarMirror?: () => Promise<string | null>, putCalendarMirror?: (value: string) => Promise<void> }} IdbAdapter
 */

/**
 * @param {StorageAdapter} storage
 * @param {ModuleDef} def
 */
export function collectModuleEntries(storage, def) {
  /** @type {Record<string, string>} */
  const entries = {};
  if (def.kind === "key") {
    const raw = storage.getItem(def.key);
    if (raw != null && raw !== "") entries[def.key] = raw;
    return entries;
  }
  const prefix = def.prefix;
  for (const key of storage.keys()) {
    if (key.startsWith(prefix)) {
      const raw = storage.getItem(key);
      if (raw != null) entries[key] = raw;
    }
  }
  return entries;
}

/**
 * @param {StorageAdapter} storage
 */
export function collectAllModules(storage) {
  /** @type {Record<string, { schemaVersion: number, count: number, entries: Record<string, string> }>} */
  const modules = {};
  for (const def of MODULE_DEFS) {
    const entries = collectModuleEntries(storage, def);
    const count = Object.values(entries).reduce((sum, raw) => sum + countFromRawValue(raw), 0);
    if (Object.keys(entries).length > 0) {
      modules[def.id] = {
        schemaVersion: def.schemaVersion || 1,
        count,
        entries,
      };
    }
  }
  return modules;
}

/**
 * @param {Record<string, unknown>} payload
 */
export async function computeIntegrityChecksum(payload, subtle) {
  const canonical = stableStringify(payload);
  const data = new TextEncoder().encode(canonical);
  if (!subtle || !subtle.digest) {
    return { algorithm: "SHA-256", checksum: "unavailable" };
  }
  const buf = await subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { algorithm: "SHA-256", checksum: hex };
}

/**
 * @param {unknown} value
 */
export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * @param {StorageAdapter} storage
 * @param {string} appVersion
 * @param {SubtleCrypto | undefined} subtle
 */
export async function buildBackupObject(storage, appVersion, subtle) {
  const modules = collectAllModules(storage);
  const createdAt = new Date().toISOString();
  const body = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_PAYLOAD_VERSION,
    createdAt,
    appVersion: String(appVersion || ""),
    encrypted: false,
    modules,
  };
  const integrity = await computeIntegrityChecksum(buildIntegrityPayload(body), subtle);
  return { ...body, integrity };
}

function requireSubtle(subtle) {
  if (!subtle || !subtle.importKey || !subtle.deriveBits || !subtle.encrypt || !subtle.decrypt) {
    throw new Error("BACKUP_CRYPTO_UNAVAILABLE");
  }
}

function bytesToB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** @returns {null | "too_short" | "empty"} */
export function explainBackupPasswordRejection(password) {
  const s = String(password || "");
  if (!s) return "empty";
  if (s.length < BACKUP_PASSWORD_MIN_LEN) return "too_short";
  return null;
}

/**
 * @param {string} password
 * @param {Uint8Array} saltBytes
 * @param {number} iterations
 * @param {SubtleCrypto} subtle
 */
async function deriveBackupAesKey(password, saltBytes, iterations, subtle) {
  const baseKey = await subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    256
  );
  return subtle.importKey("raw", bits, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * @param {string} plaintextUtf8
 * @param {string} password
 * @param {SubtleCrypto} subtle
 * @param {{ createdAt?: string, appVersion?: string }} [meta]
 */
export async function encryptBackupPlaintext(plaintextUtf8, password, subtle, meta = {}) {
  requireSubtle(subtle);
  const reject = explainBackupPasswordRejection(password);
  if (reject) throw new Error(`BACKUP_PASSWORD_WEAK|${reject}`);
  const rnd = globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function"
    ? (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
    : null;
  if (!rnd) throw new Error("BACKUP_CRYPTO_UNAVAILABLE");
  const salt = rnd(BACKUP_SALT_BYTES);
  const iv = rnd(BACKUP_IV_BYTES);
  const key = await deriveBackupAesKey(password, salt, BACKUP_PBKDF2_ITERATIONS, subtle);
  const aad = new TextEncoder().encode("iu-backup-v2");
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    new TextEncoder().encode(String(plaintextUtf8))
  );
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    encrypted: true,
    createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
    appVersion: typeof meta.appVersion === "string" ? meta.appVersion : "",
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: BACKUP_PBKDF2_ITERATIONS,
      salt: bytesToB64(salt),
    },
    cipher: {
      alg: "AES-GCM",
      iv: bytesToB64(iv),
      aad: bytesToB64(aad),
      ct: bytesToB64(new Uint8Array(ct)),
    },
  };
}

/**
 * @param {Record<string, unknown>} envelope
 * @param {string} password
 * @param {SubtleCrypto} subtle
 * @returns {Promise<string>} plaintext UTF-8 JSON
 */
export async function decryptBackupEnvelope(envelope, password, subtle) {
  requireSubtle(subtle);
  if (!envelope || typeof envelope !== "object") throw new Error("BACKUP_INVALID");
  if (envelope.format !== BACKUP_FORMAT) throw new Error("BACKUP_WRONG_FORMAT");
  if (envelope.encrypted !== true) throw new Error("BACKUP_INVALID");
  if (typeof envelope.backupVersion !== "number") throw new Error("BACKUP_INVALID_VERSION");
  if (envelope.backupVersion > BACKUP_VERSION) throw new Error("BACKUP_NEWER_VERSION");
  if (envelope.backupVersion < 2) throw new Error("BACKUP_UNSUPPORTED_VERSION");
  const kdf = envelope.kdf;
  const cipher = envelope.cipher;
  if (!kdf || typeof kdf !== "object" || !cipher || typeof cipher !== "object") throw new Error("BACKUP_INVALID");
  if (kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256") throw new Error("BACKUP_UNSUPPORTED_VERSION");
  if (cipher.alg !== "AES-GCM") throw new Error("BACKUP_UNSUPPORTED_VERSION");
  const iterations = Number(kdf.iterations);
  if (!Number.isFinite(iterations) || iterations < 100000 || iterations > 2000000) {
    throw new Error("BACKUP_UNSUPPORTED_VERSION");
  }
  const salt = b64ToBytes(kdf.salt);
  const iv = b64ToBytes(cipher.iv);
  const ct = b64ToBytes(cipher.ct);
  if (salt.length < 8 || iv.length !== BACKUP_IV_BYTES || ct.length < 16) throw new Error("BACKUP_INVALID");
  const aad = cipher.aad ? b64ToBytes(cipher.aad) : new TextEncoder().encode("iu-backup-v2");
  const key = await deriveBackupAesKey(password, salt, iterations, subtle);
  try {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("BACKUP_DECRYPT_FAILED");
  }
}

export function isEncryptedBackupEnvelope(value) {
  return !!(value && typeof value === "object" && value.encrypted === true);
}

/**
 * @param {StorageAdapter} storage
 * @param {string} appVersion
 * @param {SubtleCrypto | undefined} subtle
 * @param {string} password
 */
export async function exportBackupJson(storage, appVersion, subtle, password) {
  requireSubtle(subtle);
  const reject = explainBackupPasswordRejection(password);
  if (reject) throw new Error(`BACKUP_PASSWORD_WEAK|${reject}`);
  const backup = await buildBackupObject(storage, appVersion, subtle);
  const envelope = await encryptBackupPlaintext(JSON.stringify(backup), password, subtle, {
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
  });
  return JSON.stringify(envelope);
}

/**
 * @param {unknown} backup
 */
export function validateBackupStructure(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) throw new Error("BACKUP_INVALID");
  const b = backup;
  if (b.format !== BACKUP_FORMAT) throw new Error("BACKUP_WRONG_FORMAT");
  if (typeof b.backupVersion !== "number") throw new Error("BACKUP_INVALID_VERSION");
  if (b.backupVersion > BACKUP_PAYLOAD_VERSION) throw new Error("BACKUP_NEWER_VERSION");
  if (b.backupVersion < 1) throw new Error("BACKUP_UNSUPPORTED_VERSION");
  if (typeof b.createdAt !== "string") throw new Error("BACKUP_INVALID");
  if (typeof b.encrypted === "boolean" && b.encrypted === true) throw new Error("BACKUP_ENCRYPTED_UNSUPPORTED");
  if (!b.modules || typeof b.modules !== "object" || Array.isArray(b.modules)) throw new Error("BACKUP_INVALID_MODULES");
  for (const [modId, modVal] of Object.entries(b.modules)) {
    const def = MODULE_DEFS.find((d) => d.id === modId);
    if (!def) throw new Error("BACKUP_UNKNOWN_MODULE");
    if (!modVal || typeof modVal !== "object" || Array.isArray(modVal)) throw new Error("BACKUP_INVALID_MODULE");
    if (!modVal.entries || typeof modVal.entries !== "object" || Array.isArray(modVal.entries)) {
      throw new Error("BACKUP_INVALID_MODULE_ENTRIES");
    }
    assertSafeJsonValue(modVal.entries, 0);
    for (const [entryKey, entryVal] of Object.entries(modVal.entries)) {
      if (typeof entryVal !== "string") throw new Error("BACKUP_INVALID_ENTRY");
      if (def.kind === "key" && entryKey !== def.key) throw new Error("BACKUP_INVALID_ENTRY_KEY");
      if (def.kind === "prefix" && !entryKey.startsWith(def.prefix)) throw new Error("BACKUP_INVALID_ENTRY_KEY");
      if (entryVal.length > MAX_STRING_LEN) throw new Error("BACKUP_STRING_TOO_LONG");
    }
  }
  return b;
}

/**
 * @param {unknown} backup
 * @param {SubtleCrypto | undefined} subtle
 */
export async function verifyBackupIntegrity(backup, subtle) {
  const b = validateBackupStructure(backup);
  if (!b.integrity || typeof b.integrity !== "object") throw new Error("BACKUP_INTEGRITY_MISSING");
  const expected = b.integrity.checksum;
  if (expected === "unavailable") return b;
  const computed = await computeIntegrityChecksum(buildIntegrityPayload(b), subtle);
  if (computed.checksum !== expected) throw new Error("BACKUP_CHECKSUM_MISMATCH");
  return b;
}

/**
 * Parse, validate structure, and verify integrity in one step.
 * Encrypted v2 envelopes require password; legacy plaintext v1 does not.
 * @param {string} raw
 * @param {SubtleCrypto | undefined} subtle
 * @param {string} [password]
 */
export async function parseAndVerifyBackupText(raw, subtle, password) {
  const parsed = parseBackupJson(raw);
  if (isEncryptedBackupEnvelope(parsed)) {
    if (!password) throw new Error("BACKUP_PASSWORD_REQUIRED");
    const innerText = await decryptBackupEnvelope(parsed, password, subtle);
    const inner = parseBackupJson(innerText);
    return verifyBackupIntegrity(inner, subtle);
  }
  // Legacy plaintext export (v1 only).
  if (typeof parsed.backupVersion === "number" && parsed.backupVersion > BACKUP_PAYLOAD_VERSION) {
    throw new Error("BACKUP_NEWER_VERSION");
  }
  return verifyBackupIntegrity(parsed, subtle);
}

/**
 * @param {unknown} backup
 */
export function getBackupPreview(backup) {
  const b = validateBackupStructure(backup);
  /** @type {{ id: string, label: string, count: number }[]} */
  const list = [];
  for (const def of MODULE_DEFS) {
    const mod = b.modules[def.id];
    if (!mod) continue;
    list.push({
      id: def.id,
      label: def.label,
      count: typeof mod.count === "number" ? mod.count : countModuleEntries(mod.entries),
    });
  }
  return {
    createdAt: b.createdAt,
    backupVersion: b.backupVersion,
    appVersion: b.appVersion || "",
    encrypted: !!b.encrypted,
    modules: list,
  };
}

/**
 * @param {StorageAdapter} storage
 * @param {ModuleDef} def
 */
export function removeModuleEntries(storage, def) {
  if (def.kind === "key") {
    storage.removeItem(def.key);
    return;
  }
  for (const key of storage.keys()) {
    if (key.startsWith(def.prefix)) storage.removeItem(key);
  }
}

/**
 * @typedef {{ persistEntry?: (key: string, value: string) => void | Promise<void>, removeEntry?: (key: string) => void | Promise<void> }} BackupPersistHooks
 */

/**
 * @param {StorageAdapter} storage
 * @param {ModuleDef} def
 * @param {BackupPersistHooks} [hooks]
 */
export async function removeModuleEntriesAsync(storage, def, hooks) {
  const removeEntry = hooks && hooks.removeEntry;
  if (def.kind === "key") {
    if (removeEntry) await removeEntry(def.key);
    else storage.removeItem(def.key);
    return;
  }
  for (const key of storage.keys()) {
    if (key.startsWith(def.prefix)) {
      if (removeEntry) await removeEntry(key);
      else storage.removeItem(key);
    }
  }
}

/**
 * @param {StorageAdapter} storage
 * @param {{ schemaVersion?: number, count?: number, entries: Record<string, string> }} mod
 * @param {ModuleDef} def
 * @param {BackupPersistHooks} [hooks]
 */
export async function writeModuleEntriesAsync(storage, mod, def, hooks) {
  await removeModuleEntriesAsync(storage, def, hooks);
  const persistEntry = hooks && hooks.persistEntry;
  for (const [key, val] of Object.entries(mod.entries || {})) {
    if (typeof val !== "string") throw new Error("BACKUP_INVALID_ENTRY");
    if (def.kind === "key" && key !== def.key) throw new Error("BACKUP_INVALID_ENTRY_KEY");
    if (def.kind === "prefix" && !key.startsWith(def.prefix)) throw new Error("BACKUP_INVALID_ENTRY_KEY");
    if (persistEntry) await persistEntry(key, val);
    else storage.setItem(key, val);
  }
}

/**
 * @param {StorageAdapter} storage
 * @param {{ schemaVersion?: number, count?: number, entries: Record<string, string> }} mod
 * @param {ModuleDef} def
 */
export function writeModuleEntries(storage, mod, def) {
  removeModuleEntries(storage, def);
  for (const [key, val] of Object.entries(mod.entries || {})) {
    if (typeof val !== "string") throw new Error("BACKUP_INVALID_ENTRY");
    if (def.kind === "key" && key !== def.key) throw new Error("BACKUP_INVALID_ENTRY_KEY");
    if (def.kind === "prefix" && !key.startsWith(def.prefix)) throw new Error("BACKUP_INVALID_ENTRY_KEY");
    storage.setItem(key, val);
  }
}

/**
 * @param {StorageAdapter} storage
 * @param {IdbAdapter} idb
 * @param {ReturnType<typeof validateBackupStructure>} backup
 */
export async function applyBackupReplaceMode(storage, idb, backup) {
  const snapshot = collectAllModules(storage);
  const touched = Object.keys(backup.modules);
  try {
    for (const modId of touched) {
      const def = MODULE_DEFS.find((d) => d.id === modId);
      if (!def) throw new Error("BACKUP_UNKNOWN_MODULE");
      const mod = backup.modules[modId];
      writeModuleEntries(storage, mod, def);
    }
    if (touched.includes("calendar") && idb.putCalendarMirror) {
      const calMod = backup.modules.calendar;
      const raw = calMod && calMod.entries[CALENDAR_IDB.localStorageKey];
      if (typeof raw === "string" && raw) await idb.putCalendarMirror(raw);
    }
  } catch (err) {
    for (const def of MODULE_DEFS) {
      if (!touched.includes(def.id)) continue;
      const snap = snapshot[def.id];
      if (snap) writeModuleEntries(storage, snap, def);
      else removeModuleEntries(storage, def);
    }
    if (touched.includes("calendar") && idb.putCalendarMirror) {
      const snap = snapshot.calendar;
      const raw = snap && snap.entries[CALENDAR_IDB.localStorageKey];
      if (typeof raw === "string") await idb.putCalendarMirror(raw);
    }
    throw err;
  }
}

/**
 * Vault-aware import: await each protected-key persist/remove hook before continuing.
 * @param {StorageAdapter} storage
 * @param {IdbAdapter} idb
 * @param {ReturnType<typeof validateBackupStructure>} backup
 * @param {BackupPersistHooks} [hooks]
 */
export async function applyBackupReplaceModeAsync(storage, idb, backup, hooks) {
  const snapshot = collectAllModules(storage);
  const touched = Object.keys(backup.modules);
  try {
    for (const modId of touched) {
      const def = MODULE_DEFS.find((d) => d.id === modId);
      if (!def) throw new Error("BACKUP_UNKNOWN_MODULE");
      const mod = backup.modules[modId];
      await writeModuleEntriesAsync(storage, mod, def, hooks);
    }
    if (touched.includes("calendar") && idb.putCalendarMirror) {
      const calMod = backup.modules.calendar;
      const raw = calMod && calMod.entries[CALENDAR_IDB.localStorageKey];
      if (typeof raw === "string" && raw) await idb.putCalendarMirror(raw);
    }
  } catch (err) {
    for (const def of MODULE_DEFS) {
      if (!touched.includes(def.id)) continue;
      const snap = snapshot[def.id];
      if (snap) await writeModuleEntriesAsync(storage, snap, def, hooks);
      else await removeModuleEntriesAsync(storage, def, hooks);
    }
    if (touched.includes("calendar") && idb.putCalendarMirror) {
      const snap = snapshot.calendar;
      const raw = snap && snap.entries[CALENDAR_IDB.localStorageKey];
      if (typeof raw === "string") await idb.putCalendarMirror(raw);
    }
    throw err;
  }
}

/**
 * @param {StorageAdapter} storage
 * @param {StorageAdapter} before
 * @param {StorageAdapter} after
 */
export function storageSnapshotsEqual(before, after) {
  const keysBefore = new Set(before.keys());
  const keysAfter = new Set(after.keys());
  if (keysBefore.size !== keysAfter.size) return false;
  for (const key of keysBefore) {
    if (before.getItem(key) !== after.getItem(key)) return false;
  }
  return true;
}

/**
 * @param {Date} [date]
 */
export function formatBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `InfoUzel-zaloha-${y}-${m}-${d}-${h}-${min}${BACKUP_FILE_EXT}`;
}

/** @param {string} code */
export function userMessageForError(code) {
  const map = {
    BACKUP_INVALID: "Vybraný soubor není platná záloha InfoUzelu.",
    BACKUP_INVALID_JSON: "Soubor nelze přečíst — obsah není platný formát zálohy.",
    BACKUP_READ_FAILED: "Soubor není možné přečíst.",
    BACKUP_TOO_LARGE: "Soubor je příliš velký.",
    BACKUP_WRONG_FORMAT: "Soubor není záloha InfoUzelu.",
    BACKUP_INVALID_VERSION: "Záloha má neplatnou verzi.",
    BACKUP_NEWER_VERSION: "Tato záloha byla vytvořena novější verzí InfoUzelu a aktuální verze ji neumí bezpečně obnovit.",
    BACKUP_UNSUPPORTED_VERSION: "Verze zálohy není podporovaná.",
    BACKUP_ENCRYPTED_UNSUPPORTED: "Tento šifrovaný formát zálohy není podporovaný.",
    BACKUP_CHECKSUM_MISMATCH: "Záloha je poškozená nebo byla upravena.",
    BACKUP_INTEGRITY_MISSING: "Záloha postrádá kontrolní údaje integrity.",
    BACKUP_UNSAFE_KEY: "Soubor obsahuje neplatnou strukturu.",
    BACKUP_DEPTH_EXCEEDED: "Soubor obsahuje příliš složitou strukturu.",
    BACKUP_STRING_TOO_LONG: "Soubor obsahuje příliš dlouhá data.",
    BACKUP_CRYPTO_UNAVAILABLE: "Prohlížeč nepodporuje šifrování zálohy.",
    BACKUP_PASSWORD_REQUIRED: "Pro obnovení šifrované zálohy zadejte heslo zálohy.",
    BACKUP_PASSWORD_WEAK: "Heslo zálohy musí mít alespoň 8 znaků.",
    BACKUP_PASSWORD_MISMATCH: "Heslo a potvrzení hesla se neshodují.",
    BACKUP_DECRYPT_FAILED: "Heslo zálohy je nesprávné, nebo je soubor poškozený. Původní data nebyla změněna.",
    BACKUP_CANCELLED: "Vytváření zálohy bylo zrušeno.",
    VAULT_LOCKED_IMPORT:
      "Před obnovou zálohy odemkněte osobní data (Můj infoUzel.cz / MindMenu). Obnova chráněných dat vyžaduje aktivní odemknutý trezor.",
    VAULT_LOCKED_EXPORT:
      "Před vytvořením zálohy odemkněte osobní data (Můj infoUzel.cz / MindMenu). Záloha chráněných dat vyžaduje aktivní odemknutý trezor.",
    BACKUP_DATA_CHANGED: "Během exportu došlo ke změně dat. Zkuste export znovu.",
  };
  if (typeof code === "string" && code.startsWith("BACKUP_PASSWORD_WEAK|")) {
    return "Heslo zálohy musí mít alespoň 8 znaků.";
  }
  if (code && map[code]) return map[code];
  if (typeof code === "string" && code.startsWith("BACKUP_")) return "Zálohu se nepodařilo zpracovat.";
  return "Operace se nezdařila.";
}

/** @param {Error | string} err */
export function errorCodeFrom(err) {
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return "BACKUP_UNKNOWN";
}
