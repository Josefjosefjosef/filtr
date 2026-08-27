/**
 * Wipe personal vault — forgot PIN flow (atomic, no reload required).
 */
import { listProtectedExactKeys, listProtectedPrefixKeys } from "./iu-vault-protected-keys-v1.js";
import { wipeVaultDatabase, wipeCalendarMirrorIdb } from "./iu-vault-db-v1.js";
import { clearVaultMemoryCache, ENC_PREFIX } from "./iu-vault-storage-v1.js";
import { lockVault, clearAppLockHint, postVaultLockMessage, clearLevel1MdkBackup } from "./iu-vault-lock-v1.js";

export const WIPE_CONFIRM_PHRASE = "VYMAZAT OSOBNÍ DATA";

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Trim + case-insensitive + NFC + diacritics-insensitive + NBSP/whitespace normalize. */
export function normalizeWipeConfirmPhrase(value) {
  return stripDiacritics(
    String(value || "")
      .normalize("NFC")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("cs-CZ")
  );
}

/** Alias for UI/guards — single canonical normalizer. */
export const normalizeWipeConfirmation = normalizeWipeConfirmPhrase;

export function isWipeConfirmPhraseAccepted(value) {
  return normalizeWipeConfirmPhrase(value) === normalizeWipeConfirmPhrase(WIPE_CONFIRM_PHRASE);
}

/** Alias for UI/guards — same validator as submit. */
export const isWipeConfirmationValid = isWipeConfirmPhraseAccepted;

export async function wipePersonalVault() {
  clearVaultMemoryCache();
  try {
    window.__iuVaultHydrationPending = true;
    window.__iuVaultHydrationComplete = false;
  } catch (_) {}

  try {
    await lockVault("wiped");
  } catch (_) {}

  const exact = listProtectedExactKeys();
  for (const key of exact) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
    try {
      localStorage.removeItem(ENC_PREFIX + key);
    } catch (_) {}
  }
  const prefixes = listProtectedPrefixKeys();
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(ENC_PREFIX)) {
      const bare = k.slice(ENC_PREFIX.length);
      for (const p of prefixes) {
        if (bare.startsWith(p)) toRemove.push(k);
      }
      continue;
    }
    for (const p of prefixes) {
      if (k.startsWith(p)) toRemove.push(k);
    }
  }
  for (const k of toRemove) {
    try {
      localStorage.removeItem(k);
    } catch (_) {}
  }
  clearLevel1MdkBackup();

  try {
    sessionStorage.removeItem("iuSilver.pendingFirstMessage.v1");
    sessionStorage.removeItem("iu_silver_line_n_persistence_v1");
  } catch (_) {}

  await wipeCalendarMirrorIdb();
  await wipeVaultDatabase();

  const { readMeta, writeMeta, defaultMeta } = await import("./iu-vault-db-v1.js");
  let meta = await defaultMeta();
  try {
    const existing = await readMeta();
    if (existing && existing.createdAt) meta.createdAt = existing.createdAt;
  } catch (_) {}
  meta.pinEnabled = false;
  meta.deviceEnabled = false;
  meta.securityLevel = 1;
  meta.mindMenuUnlockMethod = "none";
  meta.migrationComplete = true;
  await writeMeta(meta);

  clearAppLockHint();

  const { ensureLevel1Mdk } = await import("./iu-vault-lock-v1.js");
  const { migratePlaintextToVault } = await import("./iu-vault-migrate-v1.js");
  const { preloadAllVaultRecords, notifyVaultMemoryHydrated } = await import("./iu-vault-storage-v1.js");
  try {
    await ensureLevel1Mdk();
    await migratePlaintextToVault();
    await preloadAllVaultRecords();
    notifyVaultMemoryHydrated();
  } finally {
    try {
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = true;
      window.__iuVaultHydratedAt = Date.now();
      window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
      window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
      window.dispatchEvent(new CustomEvent("iu-vault-wiped"));
    } catch (_) {}
  }
  postVaultLockMessage("wiped", "forgot_pin");
}
