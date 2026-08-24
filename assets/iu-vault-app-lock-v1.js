/**
 * Global InfoUzel app lock — L2/L3 full-application gate (not MindMenu-only).
 */
import { APP_LOCK_HINT_KEY, registerVaultLockBroadcastListener } from "./iu-vault-lock-v1.js";

const LOCK_SCREEN_ID = "iuVaultAppLockScreen";

export function syncAppLockHintFromMeta(meta) {
  if (!meta) return;
  const active =
    meta.pinEnabled ||
    meta.deviceEnabled ||
    meta.mindMenuUnlockMethod === "pin" ||
    meta.mindMenuUnlockMethod === "device";
  try {
    if (active) localStorage.setItem(APP_LOCK_HINT_KEY, "1");
    else localStorage.removeItem(APP_LOCK_HINT_KEY);
  } catch (_) {}
}

export function applyAppLockedPresentation(locked) {
  try {
    if (locked) document.documentElement.classList.add("iu-vault-app-locked");
    else document.documentElement.classList.remove("iu-vault-app-locked");
  } catch (_) {}
  const screen = document.getElementById(LOCK_SCREEN_ID);
  if (!screen) return;
  if (locked) {
    screen.hidden = false;
    screen.removeAttribute("aria-hidden");
  } else {
    screen.hidden = true;
    screen.setAttribute("aria-hidden", "true");
  }
}

function deviceUnlockUserMessage(err) {
  const code = String(err && err.message ? err.message : err);
  if (code.includes("VAULT_DEVICE_CANCELLED")) {
    return "Odemknutí bylo zrušeno. InfoUzel zůstává zamčen.";
  }
  if (code.includes("VAULT_DEVICE_TIMEOUT")) {
    return "Vypršel časový limit. Zkuste odemknutí znovu.";
  }
  if (/^DEVICE_[A-Z0-9_]+/.test(code)) {
    const phase = code.split("|")[0];
    return `Odemknutí zařízením se nezdařilo (${phase}).`;
  }
  return "Odemknutí zařízením se nezdařilo.";
}

export async function refreshGlobalAppLockUi(vault) {
  if (!vault) return;
  const configured = await vault.getSecurityConfigured();
  const st = vault.getState();
  const method = configured && configured.unlockMethod ? configured.unlockMethod : "none";
  const deviceSupported = await vault.detectDeviceSupport();
  const locked = method !== "none" && !st.unlocked;

  syncAppLockHintFromMeta(configured && configured.meta ? configured.meta : null);
  applyAppLockedPresentation(locked);

  const pinInput = document.getElementById("iuVaultPinInput");
  const pinLabel = document.getElementById("iuVaultPinLabel");
  const unlockPin = document.getElementById("iuVaultUnlockPinBtn");
  const unlockDev = document.getElementById("iuVaultUnlockDeviceBtn");
  const forgot = document.getElementById("iuVaultForgotPinBtn");
  const title = document.getElementById("iuVaultAppLockTitle");
  const text = document.getElementById("iuVaultAppLockText");
  const errEl = document.getElementById("iuVaultLockErr");

  if (title) title.textContent = "InfoUzel je zamčen";
  if (text) {
    text.textContent =
      method === "device"
        ? "Pro pokračování odemkněte InfoUzel pomocí zabezpečení tohoto zařízení."
        : method === "pin"
          ? "Pro pokračování zadejte PIN InfoUzlu."
          : "Pro pokračování odemkněte InfoUzel.";
  }
  if (pinInput) pinInput.hidden = method !== "pin";
  if (pinLabel) pinLabel.hidden = method !== "pin";
  if (unlockPin) unlockPin.hidden = method !== "pin";
  if (unlockDev) {
    unlockDev.hidden = method !== "device" || !deviceSupported;
    unlockDev.textContent = "Odemknout InfoUzel";
  }
  if (forgot) forgot.hidden = method !== "pin";
  if (!locked && errEl) errEl.textContent = "";
}

function bindUnlockHandlers(vault) {
  if (bindUnlockHandlers._done) return;
  bindUnlockHandlers._done = true;

  document.getElementById("iuVaultUnlockPinBtn")?.addEventListener("click", async () => {
    const pin = document.getElementById("iuVaultPinInput")?.value || "";
    const err = document.getElementById("iuVaultLockErr");
    try {
      await vault.unlockPin(pin);
      await vault.afterUnlock();
      if (err) err.textContent = "";
      const inp = document.getElementById("iuVaultPinInput");
      if (inp) inp.value = "";
      await refreshGlobalAppLockUi(vault);
      try {
        window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
      } catch (_) {}
    } catch (_) {
      if (err) err.textContent = "Neplatný PIN.";
    }
  });

  document.getElementById("iuVaultUnlockDeviceBtn")?.addEventListener("click", async () => {
    const err = document.getElementById("iuVaultLockErr");
    const btn = document.getElementById("iuVaultUnlockDeviceBtn");
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    if (err) err.textContent = "";
    try {
      await vault.unlockDevice();
      await vault.afterUnlock();
      if (err) err.textContent = "";
      await refreshGlobalAppLockUi(vault);
      try {
        window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
      } catch (_) {}
    } catch (e) {
      if (err) err.textContent = deviceUnlockUserMessage(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("iuVaultForgotPinBtn")?.addEventListener("click", async () => {
    const step1 = window.confirm(
      "PIN nelze obnovit.\n\nPokračováním nenávratně odstraníte osobní data uložená v tomto prohlížeči."
    );
    if (!step1) return;
    const typed = window.prompt("Pro potvrzení napište přesně: VYMAZAT OSOBNÍ DATA");
    if (typed !== "VYMAZAT OSOBNÍ DATA") return;
    await vault.wipePersonal();
    window.location.reload();
  });

  window.addEventListener("iu-vault-locked", () => {
    refreshGlobalAppLockUi(vault).catch(() => {});
  });
  window.addEventListener("iu-vault-unlocked", () => {
    refreshGlobalAppLockUi(vault).catch(() => {});
  });
  window.addEventListener("iu-vault-security-changed", () => {
    refreshGlobalAppLockUi(vault).catch(() => {});
  });
}

export async function initGlobalAppLock(vault) {
  if (!vault || vaultDisabled()) return;
  registerVaultLockBroadcastListener(vault);
  bindUnlockHandlers(vault);
  await refreshGlobalAppLockUi(vault);
}

function vaultDisabled() {
  try {
    if (new URLSearchParams(location.search).get("iuVault") === "0") return true;
    if (localStorage.getItem("iu:vault:disabled:v1") === "1") return true;
  } catch (_) {}
  return false;
}

export async function enforceFailClosedAppLock(vault, meta) {
  if (!vault || !meta) return;
  const needsReauth =
    meta.pinEnabled ||
    meta.deviceEnabled ||
    meta.mindMenuUnlockMethod === "pin" ||
    meta.mindMenuUnlockMethod === "device";
  if (!needsReauth) return;
  syncAppLockHintFromMeta(meta);
  applyAppLockedPresentation(true);
  try {
    window.__iuVaultHydrationPending = true;
    window.__iuVaultHydrationComplete = false;
  } catch (_) {}
}
