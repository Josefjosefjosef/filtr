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

function installLockedPersonalEntryBlock() {
  if (installLockedPersonalEntryBlock._done) return;
  installLockedPersonalEntryBlock._done = true;

  const wrapOpenOverlay = () => {
    const current = window.iuArticleActionsOpenOverlay;
    if (typeof current !== "function" || current.__iuVaultLockWrapped) return;
    const wrapped = function iuVaultBlockedArticleActionsOpenOverlay() {
      if (document.documentElement.classList.contains("iu-vault-app-locked")) return;
      return current.apply(this, arguments);
    };
    wrapped.__iuVaultLockWrapped = true;
    window.iuArticleActionsOpenOverlay = wrapped;
  };

  wrapOpenOverlay();
  window.addEventListener("iu-vault-ready", wrapOpenOverlay);
  document.addEventListener("DOMContentLoaded", wrapOpenOverlay);
  try {
    const obs = new MutationObserver(wrapOpenOverlay);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
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

  try {
    window.__iuVaultDeferMindMenuMount = !!locked;
    if (locked && typeof window.iuArticleActionsCloseOverlay === "function") {
      window.iuArticleActionsCloseOverlay();
    }
  } catch (_) {}

  installLockedPersonalEntryBlock();

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
  setWipeConfirmVisible(false);
  restorePinViewportAfterUnlock();
}

function setWipeConfirmVisible(visible) {
  const wipePanel = document.getElementById("iuVaultWipeConfirm");
  const mainActions = document.getElementById("iuVaultLockMainActions");
  if (wipePanel) {
    wipePanel.hidden = !visible;
    wipePanel.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  if (mainActions) mainActions.hidden = !!visible;
  if (!visible) {
    const inp = document.getElementById("iuVaultWipePhraseInput");
    if (inp) inp.value = "";
  }
}

function restorePinViewportAfterUnlock() {
  try {
    if (document.documentElement.classList.contains("iu-vault-app-locked")) return;
    const vv = window.visualViewport;
    if (vv && typeof vv.scale === "number" && vv.scale > 1.01) {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
      try {
        window.scrollTo(0, 0);
      } catch (_) {}
    }
  } catch (_) {}
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

  document.getElementById("iuVaultForgotPinBtn")?.addEventListener("click", () => {
    const err = document.getElementById("iuVaultLockErr");
    if (err) err.textContent = "";
    setWipeConfirmVisible(true);
    try {
      document.getElementById("iuVaultWipePhraseInput")?.focus();
    } catch (_) {}
  });

  document.getElementById("iuVaultWipeCancelBtn")?.addEventListener("click", () => {
    const err = document.getElementById("iuVaultLockErr");
    if (err) err.textContent = "";
    setWipeConfirmVisible(false);
  });

  document.getElementById("iuVaultWipeConfirmBtn")?.addEventListener("click", async () => {
    const err = document.getElementById("iuVaultLockErr");
    const typed = document.getElementById("iuVaultWipePhraseInput")?.value || "";
    const { isWipeConfirmPhraseAccepted } = await import("./iu-vault-wipe-v1.js");
    if (!isWipeConfirmPhraseAccepted(typed)) {
      if (err) err.textContent = "Pro potvrzení napište: VYMAZAT OSOBNÍ DATA";
      return;
    }
    const btn = document.getElementById("iuVaultWipeConfirmBtn");
    if (btn) btn.disabled = true;
    try {
      await vault.wipePersonal();
      setWipeConfirmVisible(false);
      await refreshGlobalAppLockUi(vault);
      applyAppLockedPresentation(false);
      try {
        window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
      } catch (_) {}
      if (err) err.textContent = "";
    } catch (_) {
      if (err) err.textContent = "Vymazání se nezdařilo. Zkuste to znovu.";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  window.addEventListener("iu-vault-locked", (ev) => {
    const reason = ev && ev.detail && ev.detail.reason;
    if (reason === "wiped") return;
    refreshGlobalAppLockUi(vault).catch(() => {});
  });
  window.addEventListener("iu-vault-unlocked", () => {
    refreshGlobalAppLockUi(vault).catch(() => {});
  });
  window.addEventListener("iu-vault-security-changed", () => {
    refreshGlobalAppLockUi(vault).catch(() => {});
  });
  window.addEventListener("iu-vault-bfcache-restore", () => {
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
