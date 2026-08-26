/**
 * Global InfoUzel app lock — L2/L3 full-application gate (not MindMenu-only).
 */
import { APP_LOCK_HINT_KEY, registerVaultLockBroadcastListener } from "./iu-vault-lock-v1.js";
import { isWipeConfirmPhraseAccepted, WIPE_CONFIRM_PHRASE } from "./iu-vault-wipe-v1.js";

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

function clearFailedUnlockHydrationFlags() {
  try {
    // Failed unlock must not leave hydration-pending stuck (blocks UI/retry semantics).
    if (window.__iuVaultHydrationPending && !(window.iuVault && window.iuVault.getState && window.iuVault.getState().unlocked)) {
      window.__iuVaultHydrationPending = false;
    }
  } catch (_) {}
}

function ensurePinInputEditable(pinInput) {
  if (!pinInput) return;
  try {
    pinInput.disabled = false;
    pinInput.readOnly = false;
    pinInput.removeAttribute("aria-disabled");
    pinInput.removeAttribute("disabled");
    pinInput.style.pointerEvents = "auto";
  } catch (_) {}
}

/** Re-enable lock controls after cancel/background/hang — never leave PWA unlock stuck. */
export function resetAppLockUnlockControls() {
  const unlockPin = document.getElementById("iuVaultUnlockPinBtn");
  const unlockDev = document.getElementById("iuVaultUnlockDeviceBtn");
  const pinInput = document.getElementById("iuVaultPinInput");
  if (unlockPin) {
    unlockPin.disabled = false;
    unlockPin.removeAttribute("aria-disabled");
    unlockPin.style.pointerEvents = "auto";
  }
  if (unlockDev) {
    unlockDev.disabled = false;
    unlockDev.removeAttribute("aria-disabled");
    unlockDev.style.pointerEvents = "auto";
  }
  ensurePinInputEditable(pinInput);
  try {
    window.__iuVaultUnlockPinInFlight = false;
    window.__iuVaultUnlockDeviceInFlight = false;
  } catch (_) {}
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

/**
 * Derive visible primary unlock actions from configured method only.
 * L3 pin → exactly one primary (PIN). L2 device → exactly one primary (device).
 */
function applyUnlockActionVisibility(method, deviceSupported) {
  const pinInput = document.getElementById("iuVaultPinInput");
  const pinLabel = document.getElementById("iuVaultPinLabel");
  const unlockPin = document.getElementById("iuVaultUnlockPinBtn");
  const unlockDev = document.getElementById("iuVaultUnlockDeviceBtn");
  const forgot = document.getElementById("iuVaultForgotPinBtn");

  const showPin = method === "pin";
  const showDevice = method === "device" && !!deviceSupported;

  if (pinInput) pinInput.hidden = !showPin;
  if (pinLabel) pinLabel.hidden = !showPin;
  if (unlockPin) {
    unlockPin.hidden = !showPin;
    unlockPin.classList.add("iuInfoCenter__btn--primary");
    unlockPin.classList.remove("iuInfoCenter__btn--secondary");
  }
  if (unlockDev) {
    unlockDev.hidden = !showDevice;
    unlockDev.textContent = "Odemknout InfoUzel";
    unlockDev.classList.add("iuInfoCenter__btn--primary");
    unlockDev.classList.remove("iuInfoCenter__btn--secondary");
  }
  if (forgot) forgot.hidden = !showPin;
}

export async function refreshGlobalAppLockUi(vault) {
  if (!vault) return;
  const configured = await vault.getSecurityConfigured();
  const st = vault.getState();
  const method = configured && configured.unlockMethod ? configured.unlockMethod : "none";
  const deviceSupported = await vault.detectDeviceSupport();
  const locked = method !== "none" && !st.unlocked;

  syncAppLockHintFromMeta(configured && configured.meta ? configured.meta : null);
  let bootPending = false;
  try {
    bootPending = !!(locked && window.__iuVaultBootLockDecisionPending);
  } catch (_) {}

  if (bootPending) {
    try {
      window.__iuVaultBootPhase = "initializing";
      document.documentElement.classList.add("iu-vault-app-init");
      document.documentElement.classList.remove("iu-vault-app-locked");
    } catch (_) {}
    applyAppLockedPresentation(false);
  } else if (locked) {
    try {
      window.__iuVaultBootPhase = "locked";
      document.documentElement.classList.remove("iu-vault-app-init");
    } catch (_) {}
    applyAppLockedPresentation(true);
  } else {
    try {
      window.__iuVaultBootLockDecisionPending = false;
      window.__iuVaultBootPhase = "unlocked";
      document.documentElement.classList.remove("iu-vault-app-init");
    } catch (_) {}
    applyAppLockedPresentation(false);
  }

  try {
    window.__iuVaultDeferMindMenuMount = bootPending || locked;
    if (locked && typeof window.iuArticleActionsCloseOverlay === "function") {
      window.iuArticleActionsCloseOverlay();
    }
  } catch (_) {}

  installLockedPersonalEntryBlock();

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
  applyUnlockActionVisibility(method, deviceSupported);
  if (locked) resetAppLockUnlockControls();
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
    syncWipeConfirmButtonState();
  } else {
    syncWipeConfirmButtonState();
  }
}

function syncWipeConfirmButtonState() {
  const btn = document.getElementById("iuVaultWipeConfirmBtn");
  const inp = document.getElementById("iuVaultWipePhraseInput");
  if (!btn) return;
  const raw = inp ? String(inp.value || "") : "";
  const ok = isWipeConfirmPhraseAccepted(raw);
  btn.disabled = !ok;
  if (ok) {
    btn.removeAttribute("aria-disabled");
    btn.style.pointerEvents = "auto";
  } else {
    btn.setAttribute("aria-disabled", "true");
  }
}

function bindWipePhraseInputListeners() {
  if (bindWipePhraseInputListeners._done) return;
  bindWipePhraseInputListeners._done = true;
  const inp = document.getElementById("iuVaultWipePhraseInput");
  if (!inp) return;
  const sync = () => {
    syncWipeConfirmButtonState();
  };
  inp.addEventListener("input", sync);
  inp.addEventListener("change", sync);
  inp.addEventListener("keyup", sync);
  inp.addEventListener("paste", () => {
    setTimeout(sync, 0);
  });
  inp.addEventListener("compositionend", sync);
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

function pinUnlockErrorMessage(err) {
  const code = String(err && err.message ? err.message : err);
  if (code.includes("VAULT_PIN_BACKOFF")) {
    return "Příliš mnoho pokusů. Počkejte chvíli a zkuste znovu.";
  }
  return "Neplatný PIN.";
}

function bindUnlockHandlers(vault) {
  if (bindUnlockHandlers._done) return;
  bindUnlockHandlers._done = true;

  document.getElementById("iuVaultUnlockPinBtn")?.addEventListener("click", async () => {
    if (window.__iuVaultUnlockPinInFlight) return;
    window.__iuVaultUnlockPinInFlight = true;
    const pinInput = document.getElementById("iuVaultPinInput");
    const btn = document.getElementById("iuVaultUnlockPinBtn");
    const err = document.getElementById("iuVaultLockErr");
    const pin = pinInput ? String(pinInput.value || "") : "";
    // Submit may be briefly disabled; input must stay editable for retry.
    if (btn) btn.disabled = true;
    ensurePinInputEditable(pinInput);
    try {
      await vault.unlockPin(pin);
      await vault.afterUnlock();
      if (err) err.textContent = "";
      if (pinInput) pinInput.value = "";
      await refreshGlobalAppLockUi(vault);
      try {
        window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
      } catch (_) {}
    } catch (e) {
      clearFailedUnlockHydrationFlags();
      if (err) err.textContent = pinUnlockErrorMessage(e);
      ensurePinInputEditable(pinInput);
      try {
        if (pinInput) {
          pinInput.focus({ preventScroll: true });
          if (typeof pinInput.select === "function") pinInput.select();
        }
      } catch (_) {}
    } finally {
      window.__iuVaultUnlockPinInFlight = false;
      if (btn) btn.disabled = false;
      ensurePinInputEditable(pinInput);
    }
  });

  document.getElementById("iuVaultUnlockDeviceBtn")?.addEventListener("click", async () => {
    if (window.__iuVaultUnlockDeviceInFlight) return;
    const err = document.getElementById("iuVaultLockErr");
    const btn = document.getElementById("iuVaultUnlockDeviceBtn");
    if (btn && btn.disabled) return;
    window.__iuVaultUnlockDeviceInFlight = true;
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
      clearFailedUnlockHydrationFlags();
      if (err) err.textContent = deviceUnlockUserMessage(e);
    } finally {
      window.__iuVaultUnlockDeviceInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("aria-disabled");
        btn.style.pointerEvents = "auto";
      }
    }
  });

  document.getElementById("iuVaultForgotPinBtn")?.addEventListener("click", () => {
    const err = document.getElementById("iuVaultLockErr");
    if (err) err.textContent = "";
    setWipeConfirmVisible(true);
    try {
      const inp = document.getElementById("iuVaultWipePhraseInput");
      if (inp) {
        inp.value = "";
        inp.focus();
      }
    } catch (_) {}
    syncWipeConfirmButtonState();
  });

  bindWipePhraseInputListeners();

  document.getElementById("iuVaultWipeCancelBtn")?.addEventListener("click", () => {
    const err = document.getElementById("iuVaultLockErr");
    if (err) err.textContent = "";
    setWipeConfirmVisible(false);
  });

  document.getElementById("iuVaultWipeConfirmBtn")?.addEventListener("click", async () => {
    if (window.__iuVaultWipeInFlight) return;
    const err = document.getElementById("iuVaultLockErr");
    const typed = document.getElementById("iuVaultWipePhraseInput")?.value || "";
    if (!isWipeConfirmPhraseAccepted(typed)) {
      if (err) err.textContent = "Pro potvrzení napište: " + WIPE_CONFIRM_PHRASE;
      syncWipeConfirmButtonState();
      return;
    }
    const btn = document.getElementById("iuVaultWipeConfirmBtn");
    window.__iuVaultWipeInFlight = true;
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
      syncWipeConfirmButtonState();
    } finally {
      window.__iuVaultWipeInFlight = false;
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
    resetAppLockUnlockControls();
    refreshGlobalAppLockUi(vault).catch(() => {});
  });

  // PWA/iOS: WebAuthn or background can leave unlock button disabled mid-flight.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resetAppLockUnlockControls();
    }
  });
  window.addEventListener("pageshow", () => {
    resetAppLockUnlockControls();
  });
  syncWipeConfirmButtonState();
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
  try {
    window.__iuVaultBootLockDecisionPending = false;
    window.__iuVaultBootPhase = "locked";
    document.documentElement.classList.remove("iu-vault-app-init");
  } catch (_) {}
  applyAppLockedPresentation(true);
  try {
    window.__iuVaultHydrationPending = true;
    window.__iuVaultHydrationComplete = false;
  } catch (_) {}
}
