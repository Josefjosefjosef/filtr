/**
 * Wipe personal vault — forgot PIN flow.
 */
import { listProtectedExactKeys, listProtectedPrefixKeys } from "./iu-vault-protected-keys-v1.js";
import { wipeVaultDatabase, wipeCalendarMirrorIdb } from "./iu-vault-db-v1.js";
import { clearVaultMemoryCache } from "./iu-vault-storage-v1.js";
import { lockVault } from "./iu-vault-lock-v1.js";

export async function wipePersonalVault() {
  clearVaultMemoryCache();
  await lockVault("wiped");

  const exact = listProtectedExactKeys();
  for (const key of exact) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
  const prefixes = listProtectedPrefixKeys();
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k) continue;
    for (const p of prefixes) {
      if (k.startsWith(p)) toRemove.push(k);
    }
  }
  for (const k of toRemove) {
    try { localStorage.removeItem(k); } catch (_) {}
  }

  try {
    sessionStorage.removeItem("iuSilver.pendingFirstMessage.v1");
    sessionStorage.removeItem("iu_silver_line_n_persistence_v1");
  } catch (_) {}

  await wipeCalendarMirrorIdb();
  await wipeVaultDatabase();

  const { ensureLevel1Mdk } = await import("./iu-vault-lock-v1.js");
  const { migratePlaintextToVault } = await import("./iu-vault-migrate-v1.js");
  const { preloadAllVaultRecords } = await import("./iu-vault-storage-v1.js");
  await ensureLevel1Mdk();
  await migratePlaintextToVault();
  await preloadAllVaultRecords();
}
