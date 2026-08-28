/**
 * READ-ONLY conflict forensics for physical profiles stuck on conflict_idb_ls.
 * No migrate, quarantine, cleanup, flush, MDK generation, delete, or overwrite.
 */
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";
import { VAULT_SCHEMA_VERSION, decryptString } from "./iu-vault-core-v1.js";

const ENC_PREFIX = "iu:vault:enc:v1:";
const CONFLICT_LS_PREFIX = "iu:vault:enc:conflict-archive:v1:";
const CONFLICT_IDB_PREFIX = "iu.vault.conflict.archive.v1:";
const BACKUP_KEY = "iu:vault:mdk-level1-backup:v1";
const MIGRATION_ID = "l1-idb-only-v1";

function safeToken(value, maxLen) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, maxLen || 96);
}

async function sha16(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < 8; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch (_) {
    return null;
  }
}

function isEnvelope(value) {
  return !!(value && value.v === VAULT_SCHEMA_VERSION && value.ct);
}

function listLocalStorageKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
  } catch (_) {}
  return keys;
}

async function fingerprintEnvelope(env) {
  if (!isEnvelope(env)) return { present: false };
  const ct = String(env.ct || "");
  return {
    present: true,
    schemaV: env.v,
    alg: env.alg ? safeToken(env.alg, 24) : null,
    ctLen: ct.length,
    ctSha16: await sha16(ct),
    ivLen: env.iv ? String(env.iv).length : 0,
  };
}

async function tryDecryptMeta(mdk, storageKey, env) {
  if (!mdk || !isEnvelope(env)) return { ok: false, reason: "no_input" };
  try {
    const pt = await decryptString(mdk, storageKey, env);
    return { ok: true, ptLen: String(pt || "").length, ptSha16: await sha16(pt) };
  } catch (err) {
    return {
      ok: false,
      reason: safeToken(err && (err.name || err.message) ? err.name || err.message : err, 48),
    };
  }
}

export async function getConflictForensics() {
  const {
    readMeta,
    readKeyRecord,
    readRecord,
    listRecordKeys,
    readMigrationCheckpoint,
  } = await import("./iu-vault-db-v1.js");

  let pageOrigin = null;
  try {
    pageOrigin = String(location.origin || "").slice(0, 120);
  } catch (_) {}

  let bootstrapMarker = null;
  try {
    const scripts = Array.from(document.scripts || []);
    for (const s of scripts) {
      const src = String(s.src || "");
      if (src.indexOf("iu-vault-bootstrap-v1.js") >= 0) {
        bootstrapMarker = safeToken(src.split("v=")[1] || src.split("/").pop(), 96);
        break;
      }
    }
  } catch (_) {}

  let swMeta = { controlled: false, scriptUrl: null };
  try {
    const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (ctrl) {
      swMeta = {
        controlled: true,
        scriptUrl: safeToken(String(ctrl.scriptURL || "").split("/").pop(), 120),
      };
    }
  } catch (_) {}

  let storagePersisted = null;
  try {
    if (navigator.storage && typeof navigator.storage.persisted === "function") {
      storagePersisted = await navigator.storage.persisted();
    }
  } catch (_) {}

  const lsKeys = listLocalStorageKeys();
  const lsEncKeys = lsKeys.filter((k) => k.indexOf(ENC_PREFIX) === 0).map((k) => k.slice(ENC_PREFIX.length));
  const lsConflictArchiveKeys = lsKeys
    .filter((k) => k.indexOf(CONFLICT_LS_PREFIX) === 0)
    .map((k) => k.slice(CONFLICT_LS_PREFIX.length));
  const lsVaultMetaKeys = lsKeys.filter(
    (k) =>
      k.indexOf("iu:vault:") === 0 ||
      k === BACKUP_KEY ||
      k.indexOf("iu:local-data-protection") === 0
  );

  const lsInventory = [];
  for (const k of lsVaultMetaKeys.concat(lsKeys.filter((x) => x.indexOf(ENC_PREFIX) === 0 || x.indexOf(CONFLICT_LS_PREFIX) === 0))) {
    let raw = null;
    try {
      raw = localStorage.getItem(k);
    } catch (_) {}
    lsInventory.push({
      key: safeToken(k, 120),
      present: raw != null,
      len: raw != null ? String(raw).length : 0,
      sha16: raw != null ? await sha16(raw) : null,
      kind:
        k === BACKUP_KEY
          ? "legacy_mdk_backup"
          : k.indexOf(ENC_PREFIX) === 0
            ? "ls_enc_mirror"
            : k.indexOf(CONFLICT_LS_PREFIX) === 0
              ? "ls_conflict_archive"
              : "vault_meta_or_other",
    });
  }

  let idbRecordKeys = [];
  try {
    idbRecordKeys = await listRecordKeys();
  } catch (_) {}

  const idbConflictArchiveKeys = idbRecordKeys.filter((k) => String(k).indexOf(CONFLICT_IDB_PREFIX) === 0);
  const idbProtectedKeys = idbRecordKeys.filter((k) => isProtectedStorageKey(k));

  const checkpoint = await readMigrationCheckpoint(MIGRATION_ID).catch(() => null);
  const meta = await readMeta().catch(() => null);

  let keyRec = null;
  try {
    keyRec = await readKeyRecord("mdk:level1");
  } catch (_) {}

  let durablePresent = false;
  let durableLen = 0;
  try {
    const { readLevel1DurableMaterialBytes } = await import("./iu-vault-lock-v1.js");
    const raw = await readLevel1DurableMaterialBytes();
    durablePresent = !!(raw && raw.byteLength >= 16);
    durableLen = raw && raw.byteLength ? raw.byteLength : 0;
  } catch (_) {}

  let cryptoKeyUsable = false;
  const mdk = keyRec && keyRec.mdk ? keyRec.mdk : null;
  if (mdk) {
    try {
      const { encryptString } = await import("./iu-vault-core-v1.js");
      const env = await encryptString(mdk, "iu.vault.selftest.v1", "ok");
      const pt = await decryptString(mdk, "iu.vault.selftest.v1", env);
      cryptoKeyUsable = pt === "ok";
    } catch (_) {
      cryptoKeyUsable = false;
    }
  }

  const probeKeys = Array.from(
    new Set([].concat(idbProtectedKeys, lsEncKeys, lsConflictArchiveKeys).filter(Boolean))
  ).slice(0, 40);

  const records = [];
  for (const storageKey of probeKeys) {
    let idbEnv = null;
    try {
      idbEnv = await readRecord(storageKey);
    } catch (_) {}
    let lsRaw = null;
    try {
      lsRaw = localStorage.getItem(ENC_PREFIX + storageKey);
    } catch (_) {}
    let lsEnv = null;
    if (lsRaw) {
      try {
        lsEnv = JSON.parse(lsRaw);
      } catch (_) {}
    }
    const idbFp = await fingerprintEnvelope(idbEnv);
    const lsFp = await fingerprintEnvelope(lsEnv);
    let idbDec = { ok: false, reason: "skipped" };
    let lsDec = { ok: false, reason: "skipped" };
    if (cryptoKeyUsable && idbFp.present) idbDec = await tryDecryptMeta(mdk, storageKey, idbEnv);
    if (cryptoKeyUsable && lsFp.present) lsDec = await tryDecryptMeta(mdk, storageKey, lsEnv);
    const bothDecrypt = !!(idbDec.ok && lsDec.ok);
    const plaintextsEqual = bothDecrypt ? idbDec.ptSha16 === lsDec.ptSha16 : null;
    let branch = "none";
    if (idbFp.present && lsFp.present) {
      if (bothDecrypt && plaintextsEqual === false) branch = "would_conflict_idb_ls_divergent";
      else if (bothDecrypt && plaintextsEqual === true) branch = "both_match_idb_authoritative";
      else if (lsDec.ok && !idbDec.ok) branch = "ls_ok_idb_fail";
      else if (idbDec.ok && !lsDec.ok) branch = "idb_ok_ls_fail";
      else branch = "both_present_decrypt_incomplete";
    } else if (idbFp.present) branch = "idb_only";
    else if (lsFp.present) branch = "ls_only";

    records.push({
      storageKey: safeToken(storageKey, 96),
      protected: isProtectedStorageKey(storageKey),
      idb: idbFp,
      lsEnc: lsFp,
      idbDecryptOk: !!idbDec.ok,
      lsDecryptOk: !!lsDec.ok,
      plaintextsEqual,
      ptLenIdb: idbDec.ok ? idbDec.ptLen : null,
      ptLenLs: lsDec.ok ? lsDec.ptLen : null,
      decisionBranch: branch,
    });
  }

  const idbArchives = [];
  for (const k of idbConflictArchiveKeys.slice(0, 20)) {
    let env = null;
    try {
      env = await readRecord(k);
    } catch (_) {}
    idbArchives.push({
      key: safeToken(k, 120),
      envelope: await fingerprintEnvelope(env),
    });
  }

  const migrateSourceHasPreferred = { moduleLoadedProbeRemoved: true };

  let migrateBundleProbe = { fetched: false };
  try {
    const res = await fetch(new URL("./iu-vault-l1-migrate-v1.js", import.meta.url).href, {
      cache: "no-store",
    });
    const text = await res.text();
    migrateBundleProbe = {
      fetched: true,
      status: res.status,
      hasIdbPreferred: text.indexOf("idb_preferred_divergent_ls") >= 0,
      hasRetriableConflict: text.indexOf("RETRIABLE_FAIL_CLOSED") >= 0,
      stillReturnsConflictFailClosed: /reason:\s*["']conflict_idb_ls["']/.test(text),
      sha16: await sha16(text),
      len: text.length,
    };
  } catch (err) {
    migrateBundleProbe = { fetched: false, error: safeToken(err && err.message, 64) };
  }

  const divergentCount = records.filter((r) => r.decisionBranch === "would_conflict_idb_ls_divergent").length;
  const bothMatchCount = records.filter((r) => r.decisionBranch === "both_match_idb_authoritative").length;

  return {
    tag: "CONFLICT_FORENSICS_READONLY_V1",
    capturedAt: Date.now(),
    readOnly: true,
    noMigrate: true,
    noWrites: true,
    origin: pageOrigin,
    bootstrapMarker,
    serviceWorker: swMeta,
    storagePersisted,
    migrateBundleProbe,
    migrateSourceHasPreferred,
    recovery: {
      requiredFlag: !!window.__iuVaultStorageRecoveryRequired,
      reasonFlag: window.__iuVaultStorageRecoveryReason
        ? safeToken(window.__iuVaultStorageRecoveryReason, 64)
        : null,
      htmlClass: !!(document.documentElement && document.documentElement.classList.contains("iu-vault-storage-recovery")),
    },
    migrationCheckpoint: checkpoint
      ? {
          phase: checkpoint.phase ? safeToken(checkpoint.phase, 32) : null,
          reason: checkpoint.reason ? safeToken(checkpoint.reason, 64) : null,
          key: checkpoint.key ? safeToken(checkpoint.key, 96) : null,
          priorFailReason: checkpoint.priorFailReason ? safeToken(checkpoint.priorFailReason, 64) : null,
          recordsDoneCount: Array.isArray(checkpoint.recordsDone) ? checkpoint.recordsDone.length : 0,
          resolvedMdk: checkpoint.resolvedMdk ? safeToken(checkpoint.resolvedMdk, 32) : null,
          updatedAt: checkpoint.updatedAt ? safeToken(checkpoint.updatedAt, 40) : null,
        }
      : null,
    vaultMeta: meta
      ? {
          schemaVersion: meta.schemaVersion != null ? meta.schemaVersion : null,
          securityLevel: meta.securityLevel != null ? meta.securityLevel : null,
          pinEnabled: !!meta.pinEnabled,
          deviceEnabled: !!meta.deviceEnabled,
          mindMenuUnlockMethod: meta.mindMenuUnlockMethod ? safeToken(meta.mindMenuUnlockMethod, 24) : null,
          l1IdbOnly: !!meta.l1IdbOnly,
          l1IdbMigratedAt: meta.l1IdbMigratedAt ? safeToken(meta.l1IdbMigratedAt, 40) : null,
        }
      : null,
    crypto: {
      keyRecordPresent: !!(keyRec && keyRec.mdk),
      cryptoKeyUsable,
      durableMaterialPresent: durablePresent,
      durableMaterialByteLength: durableLen,
      legacyBackupPresent: (() => {
        try {
          return !!localStorage.getItem(BACKUP_KEY);
        } catch (_) {
          return null;
        }
      })(),
    },
    counts: {
      idbRecordKeys: idbRecordKeys.length,
      idbProtectedKeys: idbProtectedKeys.length,
      idbConflictArchives: idbConflictArchiveKeys.length,
      lsEncMirrors: lsEncKeys.length,
      lsConflictArchives: lsConflictArchiveKeys.length,
      probeRecords: records.length,
      divergentSameMdk: divergentCount,
      bothMatchSameMdk: bothMatchCount,
    },
    idbConflictArchives: idbArchives,
    lsInventory,
    records,
  };
}
