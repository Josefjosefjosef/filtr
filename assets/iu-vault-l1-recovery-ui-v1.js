/**
 * L1 storage recovery UI — shown when protected data exists but MDK cannot be opened.
 */
export function showVaultStorageRecovery(reason) {
  try {
    window.__iuVaultStorageRecoveryRequired = true;
    window.__iuVaultStorageRecoveryReason = String(reason || "storage_unavailable");
    document.documentElement.classList.add("iu-vault-storage-recovery");
    document.documentElement.classList.remove("iu-vault-app-init");
  } catch (_) {}

  const screen = document.getElementById("iuVaultStorageRecoveryScreen");
  if (screen) {
    screen.hidden = false;
    screen.removeAttribute("aria-hidden");
  }
  const err = document.getElementById("iuVaultStorageRecoveryDetail");
  if (err && reason) {
    err.textContent = "Technický stav: " + String(reason).slice(0, 120);
  }
  try {
    window.__iuVaultHydrationPending = true;
    window.__iuVaultHydrationComplete = false;
    window.__iuVaultDeferMindMenuMount = true;
  } catch (_) {}
}

export function hideVaultStorageRecovery() {
  try {
    window.__iuVaultStorageRecoveryRequired = false;
    document.documentElement.classList.remove("iu-vault-storage-recovery");
  } catch (_) {}
  const screen = document.getElementById("iuVaultStorageRecoveryScreen");
  if (screen) {
    screen.hidden = true;
    screen.setAttribute("aria-hidden", "true");
  }
}

export function isVaultStorageRecoveryActive() {
  try {
    return !!window.__iuVaultStorageRecoveryRequired;
  } catch (_) {
    return false;
  }
}

export async function requestVaultStoragePersist() {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== "function") {
      return { supported: false, persisted: null };
    }
    let persistedBefore = null;
    if (typeof navigator.storage.persisted === "function") {
      persistedBefore = await navigator.storage.persisted();
    }
    if (persistedBefore) return { supported: true, persisted: true, requested: false };
    const granted = await navigator.storage.persist();
    return { supported: true, persisted: !!granted, requested: true };
  } catch (_) {
    return { supported: true, persisted: false, error: true };
  }
}
