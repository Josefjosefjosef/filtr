/**
 * Vault UI — Informační centrum + MindMenu lock gate (PC desktop).
 */
(function iuVaultUiModule() {
  "use strict";

  let eventsBound = false;
  let mindMenuGateBound = false;
  let desktopHookTimer = null;
  let methodPickerOpen = false;

  function isDesktopVaultGate() {
    try {
      return !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
    } catch (_) {
      return false;
    }
  }

  function waitVault() {
    return new Promise((resolve) => {
      if (window.iuVault) {
        resolve(window.iuVault);
        return;
      }
      window.addEventListener("iu-vault-ready", () => resolve(window.iuVault), { once: true });
    });
  }

  async function readUnlockState(vault) {
    const configured = await vault.getSecurityConfigured();
    const st = vault.getState();
    const method = configured && configured.unlockMethod ? configured.unlockMethod : "none";
    return {
      vault,
      configured,
      st,
      method,
      needsLock: method !== "none" && !st.unlocked,
    };
  }

  async function vaultNeedsUserUnlock() {
    const vault = await waitVault();
    return readUnlockState(vault);
  }

  function methodLabel(method) {
    if (method === "device") return "Zabezpečení zařízení";
    if (method === "pin") return "Vlastní PIN InfoUzlu";
    return "Bez dalšího zamykání";
  }

  function injectSecuritySection() {
    const panel = document.getElementById("iuInfoCenterDetailPrivacy");
    if (!panel) return false;
    const inner = panel.querySelector(".iuInfoCenter__detailInner");
    if (!inner) return false;

    let existing = document.getElementById("iuVaultSecuritySection");
    if (existing && existing.getAttribute("data-iu-vault-ui-version") !== "2") {
      existing.remove();
      existing = null;
    }
    if (existing) return true;

    const section = document.createElement("section");
    section.id = "iuVaultSecuritySection";
    section.className = "iuVaultSecurity";
    section.setAttribute("data-iu-vault-security-ui", "1");
    section.setAttribute("data-iu-vault-ui-version", "2");
    section.innerHTML = [
      '<h3 class="iuInfoCenter__h3">Zabezpečení osobních dat</h3>',
      '<div class="iuVaultSecurity__level" data-iu-vault-level="1">',
      '  <h4 class="iuVaultSecurity__title">Standardní ochrana</h4>',
      '  <p class="iuInfoCenter__p">Vaše osobní data jsou automaticky šifrována a zůstávají pouze v tomto prohlížeči. Tato ochrana funguje vždy, bez zásahu uživatele.</p>',
      '  <p class="iuVaultSecurity__status" id="iuVaultLevel1Status"><strong>Aktivní</strong></p>',
      "</div>",
      '<div class="iuVaultSecurity__level" id="iuVaultMindMenuLockBlock">',
      '  <h4 class="iuVaultSecurity__title">Zamknutí MindMenu</h4>',
      '  <p class="iuInfoCenter__p">Chraňte své osobní údaje v MindMenu před přístupem dalších osob používajících toto zařízení.</p>',
      '  <p class="iuVaultSecurity__current" id="iuVaultMindMenuLockStatus" aria-live="polite"></p>',
      '  <p class="iuVaultSecurity__currentBackup" id="iuVaultMindMenuUnlockMethodLabel" aria-live="polite"></p>',
      '  <fieldset class="iuVaultSecurity__methodFieldset" id="iuVaultMindMenuMethodFieldset">',
      '    <legend class="iuVaultSecurity__legend">Způsob odemknutí</legend>',
      '    <label class="iuVaultSecurity__radio"><input type="radio" name="iuVaultMindMenuMethod" value="none" /> Bez dalšího zamykání</label>',
      '    <label class="iuVaultSecurity__radio" id="iuVaultMindMenuMethodDeviceLabel"><input type="radio" name="iuVaultMindMenuMethod" value="device" /> Zabezpečení zařízení — doporučeno</label>',
      '    <label class="iuVaultSecurity__radio"><input type="radio" name="iuVaultMindMenuMethod" value="pin" /> Vlastní PIN InfoUzlu</label>',
      "  </fieldset>",
      '  <p class="iuVaultSecurity__unsupported" id="iuVaultDeviceUnsupported" hidden>Zabezpečení zařízením není v tomto prohlížeči podporováno. Můžete použít vlastní PIN InfoUzlu.</p>',
      '  <button type="button" class="iuInfoCenter__btn" id="iuVaultApplyMindMenuMethodBtn">Zapnout zamykání MindMenu</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultChangePinBtn" hidden>Změnit PIN</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultChangeMindMenuMethodBtn" hidden>Změnit způsob odemknutí</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultDisableMindMenuLockBtn" hidden>Vypnout zamykání MindMenu</button>',
      '  <div class="iuVaultSecurity__auto" id="iuVaultAutoLockBlock">',
      '    <h4 class="iuVaultSecurity__title">Automaticky zamknout</h4>',
      '    <select id="iuVaultAutoLockSelect" class="iuVaultSecurity__select" aria-label="Automatické zamknutí">',
      '      <option value="manual">Pouze ručně</option>',
      '      <option value="background">Při návratu z pozadí</option>',
      '      <option value="idle_1m">Po 1 minutě nečinnosti</option>',
      '      <option value="idle_5m">Po 5 minutách nečinnosti</option>',
      '      <option value="idle_15m">Po 15 minutách nečinnosti</option>',
      "    </select>",
      '    <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultLockNowBtn">Zamknout osobní data nyní</button>',
      "  </div>",
      "</div>",
      '<p class="iuVaultSecurity__msg" id="iuVaultSecurityMsg" aria-live="polite"></p>',
      '<hr class="iuVaultSecurity__divider" aria-hidden="true">',
    ].join("");

    inner.insertBefore(section, inner.firstChild);
    return true;
  }

  function selectedMethodFromUi() {
    const checked = document.querySelector('input[name="iuVaultMindMenuMethod"]:checked');
    return checked ? String(checked.value || "none") : "none";
  }

  function setMethodRadios(method) {
    document.querySelectorAll('input[name="iuVaultMindMenuMethod"]').forEach((el) => {
      el.checked = el.value === method;
    });
  }

  function ensureLockOverlay() {
    if (document.getElementById("iuVaultLockOverlay")) return;
    const el = document.createElement("div");
    el.id = "iuVaultLockOverlay";
    el.className = "iuVaultLockOverlay";
    el.hidden = true;
    el.innerHTML = [
      '<div class="iuVaultLockOverlay__panel" role="dialog" aria-modal="true" aria-labelledby="iuVaultLockTitle">',
      '  <h2 id="iuVaultLockTitle" class="iuVaultLockOverlay__title">MindMenu je zamčen</h2>',
      '  <p class="iuVaultLockOverlay__text">Pro pokračování odemkněte osobní data.</p>',
      '  <label class="iuVaultLockOverlay__label" id="iuVaultPinLabel" hidden>PIN InfoUzlu</label>',
      '  <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="iuVaultLockOverlay__input" id="iuVaultPinInput" hidden>',
      '  <button type="button" class="iuInfoCenter__btn" id="iuVaultUnlockPinBtn" hidden>Odemknout PINem</button>',
      '  <button type="button" class="iuInfoCenter__btn" id="iuVaultUnlockDeviceBtn" hidden>Odemknout zařízením</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultForgotPinBtn" hidden>Zapomněl jsem PIN</button>',
      '  <p class="iuVaultLockOverlay__err" id="iuVaultLockErr" aria-live="polite"></p>',
      "</div>",
    ].join("");
    document.body.appendChild(el);
  }

  function ensureMindMenuLockGate() {
    const scroll = document.querySelector("#iuMyInfoUzelOverlay .iuMyInfoUzelOverlay__scroll");
    if (!scroll) return null;
    let gate = document.getElementById("iuVaultMindMenuLockGate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "iuVaultMindMenuLockGate";
      gate.className = "iuVaultMindMenuLockGate";
      gate.hidden = true;
      gate.innerHTML = [
        '<div class="iuVaultMindMenuLockGate__panel" role="region" aria-labelledby="iuVaultMindMenuLockTitle">',
        '  <h2 id="iuVaultMindMenuLockTitle" class="iuVaultMindMenuLockGate__title">MindMenu je zamčen</h2>',
        '  <p class="iuVaultMindMenuLockGate__text">Pro pokračování odemkněte osobní data.</p>',
        '  <label class="iuVaultMindMenuLockGate__label" id="iuVaultMindMenuPinLabel" hidden>PIN InfoUzlu</label>',
        '  <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="iuVaultMindMenuLockGate__input" id="iuVaultMindMenuPinInput" hidden>',
        '  <button type="button" class="iuInfoCenter__btn" id="iuVaultMindMenuUnlockPinBtn" hidden>Odemknout PINem</button>',
        '  <button type="button" class="iuInfoCenter__btn" id="iuVaultMindMenuUnlockDeviceBtn" hidden>Odemknout zařízením</button>',
        '  <p class="iuVaultMindMenuLockGate__err" id="iuVaultMindMenuLockErr" aria-live="polite"></p>',
        "</div>",
      ].join("");
      scroll.insertBefore(gate, scroll.firstChild);
    }
    return gate;
  }

  async function refreshMindMenuLockGate(meta, st, method) {
    const gate = ensureMindMenuLockGate();
    if (!gate) return;
    const vault = await waitVault();
    const deviceSupported = await vault.detectDeviceSupport();
    const unlockMethod = method || "none";
    const pinInput = document.getElementById("iuVaultMindMenuPinInput");
    const pinLabel = document.getElementById("iuVaultMindMenuPinLabel");
    const unlockPin = document.getElementById("iuVaultMindMenuUnlockPinBtn");
    const unlockDev = document.getElementById("iuVaultMindMenuUnlockDeviceBtn");
    const pinOn = unlockMethod === "pin";
    const devOn = unlockMethod === "device";
    if (pinInput) pinInput.hidden = !pinOn;
    if (pinLabel) pinLabel.hidden = !pinOn;
    if (unlockPin) unlockPin.hidden = !pinOn;
    if (unlockDev) unlockDev.hidden = !devOn || !deviceSupported;
    const locked = unlockMethod !== "none" && !st.unlocked;
    gate.hidden = !locked;
    const host = document.getElementById("iuMyInfoUzelMindMenuHost");
    const toolsHost = document.getElementById("iuMyInfoUzelToolsHost");
    if (host) host.hidden = locked;
    if (toolsHost) toolsHost.hidden = locked;
  }

  function hideMindMenuLockGate() {
    const gate = document.getElementById("iuVaultMindMenuLockGate");
    if (gate) gate.hidden = true;
    const host = document.getElementById("iuMyInfoUzelMindMenuHost");
    const toolsHost = document.getElementById("iuMyInfoUzelToolsHost");
    if (host) host.hidden = false;
    if (toolsHost) toolsHost.hidden = false;
  }

  async function showDesktopMindMenuLockGate() {
    const { meta, st, method } = await vaultNeedsUserUnlock();
    ensureMindMenuLockGate();
    await refreshMindMenuLockGate(meta, st, method);
  }

  async function remountDesktopMindMenuContent() {
    if (!isDesktopVaultGate()) return;
    if (!document.body.classList.contains("iu-myinfouzel-open")) return;
    hideMindMenuLockGate();
    if (window.__iuVaultBypassDesktopGate) return;
    window.__iuVaultBypassDesktopGate = true;
    try {
      const orig = window.__iuVaultOrigMindMenuOpen;
      if (typeof orig === "function") orig();
    } catch (_) {}
    window.__iuVaultBypassDesktopGate = false;
  }

  function installDesktopMindMenuHook() {
    const wrapOrig = (orig) => {
      if (!orig || orig._iuVaultGateHook) return orig;
      window.__iuVaultOrigMindMenuOpen = orig;
      const wrapped = async function iuVaultDesktopMindMenuOpen() {
        if (window.__iuVaultBypassDesktopGate || !isDesktopVaultGate()) {
          return orig.apply(this, arguments);
        }
        const { needsLock } = await vaultNeedsUserUnlock();
        if (!needsLock) {
          hideMindMenuLockGate();
          return orig.apply(this, arguments);
        }
        window.__iuVaultDeferMindMenuMount = true;
        try {
          const result = orig.apply(this, arguments);
          await showDesktopMindMenuLockGate();
          return result;
        } finally {
          window.__iuVaultDeferMindMenuMount = false;
        }
      };
      wrapped._iuVaultGateHook = true;
      return wrapped;
    };

    window.__iuVaultRegisterDesktopMindMenuOpen = (orig) => {
      window.iuArticleActionsOpenOverlay = wrapOrig(orig);
    };

    if (window.iuArticleActionsOpenOverlay) {
      window.iuArticleActionsOpenOverlay = wrapOrig(window.iuArticleActionsOpenOverlay);
    } else if (!desktopHookTimer) {
      desktopHookTimer = setInterval(() => {
        if (window.iuArticleActionsOpenOverlay) {
          window.iuArticleActionsOpenOverlay = wrapOrig(window.iuArticleActionsOpenOverlay);
          clearInterval(desktopHookTimer);
          desktopHookTimer = null;
        }
      }, 120);
      setTimeout(() => {
        if (desktopHookTimer) {
          clearInterval(desktopHookTimer);
          desktopHookTimer = null;
        }
      }, 120000);
    }
  }

  async function bindMindMenuGateEvents() {
    if (mindMenuGateBound) return;
    mindMenuGateBound = true;
    const vault = await waitVault();

    document.getElementById("iuVaultMindMenuUnlockPinBtn")?.addEventListener("click", async () => {
      const pin = document.getElementById("iuVaultMindMenuPinInput")?.value || "";
      const err = document.getElementById("iuVaultMindMenuLockErr");
      try {
        await vault.unlockPin(pin);
        await vault.afterUnlock();
        if (err) err.textContent = "";
        const inp = document.getElementById("iuVaultMindMenuPinInput");
        if (inp) inp.value = "";
        await remountDesktopMindMenuContent();
      } catch (e) {
        if (err) err.textContent = "Neplatný PIN.";
      }
    });

    document.getElementById("iuVaultMindMenuUnlockDeviceBtn")?.addEventListener("click", async () => {
      const err = document.getElementById("iuVaultMindMenuLockErr");
      try {
        await vault.unlockDevice();
        await vault.afterUnlock();
        if (err) err.textContent = "";
        await remountDesktopMindMenuContent();
      } catch (e) {
        const code = String(e && e.message ? e.message : e);
        if (code.includes("VAULT_DEVICE_CANCELLED")) {
          if (err) err.textContent = "Odemknutí bylo zrušeno. MindMenu zůstává zamčen.";
        } else {
          if (err) err.textContent = "Odemknutí zařízením se nezdařilo.";
        }
      }
    });

    window.addEventListener("iu-vault-locked", () => {
      if (!isDesktopVaultGate()) return;
      if (document.body.classList.contains("iu-myinfouzel-open")) {
        showDesktopMindMenuLockGate().catch(() => {});
      }
    });

    window.addEventListener("iu-vault-unlocked", () => {
      if (!isDesktopVaultGate()) return;
      if (document.body.classList.contains("iu-myinfouzel-open")) {
        remountDesktopMindMenuContent().catch(() => {});
      }
    });
  }

  async function refreshSecurityUi() {
    const vault = await waitVault();
    if (!document.getElementById("iuVaultSecuritySection")) return;
    const { configured, st, method } = await readUnlockState(vault);
    const meta = configured.meta || (await vault.getMeta());
    const deviceSupported = await vault.detectDeviceSupport();

    const statusEl = document.getElementById("iuVaultMindMenuLockStatus");
    const methodEl = document.getElementById("iuVaultMindMenuUnlockMethodLabel");
    const fieldset = document.getElementById("iuVaultMindMenuMethodFieldset");
    const applyBtn = document.getElementById("iuVaultApplyMindMenuMethodBtn");
    const changePin = document.getElementById("iuVaultChangePinBtn");
    const changeMethod = document.getElementById("iuVaultChangeMindMenuMethodBtn");
    const disableLock = document.getElementById("iuVaultDisableMindMenuLockBtn");
    const devNo = document.getElementById("iuVaultDeviceUnsupported");
    const devLabel = document.getElementById("iuVaultMindMenuMethodDeviceLabel");
    const autoBlock = document.getElementById("iuVaultAutoLockBlock");
    const autoSel = document.getElementById("iuVaultAutoLockSelect");
    const lockNow = document.getElementById("iuVaultLockNowBtn");

    if (statusEl) {
      statusEl.innerHTML =
        method === "none"
          ? "Zamknutí MindMenu: <strong>Vypnuto</strong>"
          : "✓ Zamknutí MindMenu je zapnuté";
    }
    if (methodEl) {
      methodEl.textContent =
        method === "none" ? "" : "Způsob odemknutí: " + methodLabel(method);
      methodEl.hidden = method === "none";
    }

    const active = method !== "none";
    const showPicker = !active || methodPickerOpen;

    if (fieldset) fieldset.hidden = !showPicker;
    if (applyBtn) {
      applyBtn.hidden = !showPicker;
      applyBtn.textContent = active ? "Použít nový způsob odemknutí" : "Zapnout zamykání MindMenu";
    }
    if (changePin) changePin.hidden = method !== "pin" || methodPickerOpen;
    if (changeMethod) changeMethod.hidden = !active || methodPickerOpen;
    if (disableLock) disableLock.hidden = !active || methodPickerOpen;
    if (autoBlock) autoBlock.hidden = method === "none";
    if (autoSel && meta) autoSel.value = meta.autoLockPolicy || "background";
    if (lockNow) lockNow.hidden = method === "none";

    if (devNo) devNo.hidden = deviceSupported || !showPicker;
    if (devLabel) devLabel.hidden = !deviceSupported && showPicker;
    if (fieldset && showPicker) setMethodRadios(methodPickerOpen ? selectedMethodFromUi() || method : method);

    const overlay = document.getElementById("iuVaultLockOverlay");
    if (overlay) {
      const needsLock = method !== "none" && !st.unlocked;
      const useDesktopGate = isDesktopVaultGate();
      overlay.hidden = !needsLock || useDesktopGate;
      const pinInput = document.getElementById("iuVaultPinInput");
      const pinLabel = document.getElementById("iuVaultPinLabel");
      const unlockPin = document.getElementById("iuVaultUnlockPinBtn");
      const unlockDev = document.getElementById("iuVaultUnlockDeviceBtn");
      const forgot = document.getElementById("iuVaultForgotPinBtn");
      if (pinInput) pinInput.hidden = method !== "pin";
      if (pinLabel) pinLabel.hidden = method !== "pin";
      if (unlockPin) unlockPin.hidden = method !== "pin";
      if (unlockDev) unlockDev.hidden = method !== "device" || !deviceSupported;
      if (forgot) forgot.hidden = method !== "pin";
    }

    await refreshMindMenuLockGate(meta, st, method);
  }

  function showPinSetupDialog() {
    const warn =
      "PIN nelze obnovit. Pokud jej zapomenete, nebude možné uložená osobní data otevřít. V takovém případě bude nutné osobní data v tomto prohlížeči vymazat.";
    if (!window.confirm(warn)) return null;
    const pin = window.prompt("Zadejte PIN (min. 6 číslic):");
    if (pin == null) return null;
    const confirmPin = window.prompt("Zadejte PIN znovu pro potvrzení:");
    if (confirmPin == null) return null;
    return { pin, confirm: confirmPin };
  }

  function deviceSetupUserMessage(err) {
    const code = String(err && err.message ? err.message : err);
    if (code.includes("VAULT_DEVICE_CANCELLED")) {
      return "Zabezpečení zařízením nebylo dokončeno. Nastavení zůstává beze změny.";
    }
    if (code.includes("VAULT_DEVICE_TIMEOUT")) {
      return "Vypršel časový limit pro Windows Hello. Zkuste to znovu.";
    }
    if (code.includes("VAULT_DEVICE_PRF_UNAVAILABLE")) {
      return "Toto zařízení nepodporuje bezpečné odemknutí přes Windows Hello.";
    }
    if (code.includes("VAULT_DEVICE_UNSUPPORTED")) {
      return "Zabezpečení zařízením není v tomto prohlížeči podporováno.";
    }
    return "Nastavení zabezpečení zařízením se nezdařilo.";
  }

  async function notifySecurityChanged(vault) {
    try {
      if (vault.flushPendingWrites) await vault.flushPendingWrites();
    } catch (_) {}
    methodPickerOpen = false;
    await refreshSecurityUi();
    try {
      window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
    } catch (_) {}
  }

  async function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    const vault = await waitVault();
    const msg = document.getElementById("iuVaultSecurityMsg");

    function say(text) {
      if (msg) msg.textContent = text || "";
    }

    document.getElementById("iuVaultChangeMindMenuMethodBtn")?.addEventListener("click", async () => {
      methodPickerOpen = true;
      const { method } = await readUnlockState(vault);
      setMethodRadios(method);
      await refreshSecurityUi();
    });

    document.getElementById("iuVaultApplyMindMenuMethodBtn")?.addEventListener("click", async () => {
      const target = selectedMethodFromUi();
      const { method: current, st } = await readUnlockState(vault);

      if (target === current && target !== "none") {
        methodPickerOpen = false;
        await refreshSecurityUi();
        return;
      }

      if (target === "none") {
        if (current === "none") {
          say("Zamykání MindMenu je již vypnuto.");
          return;
        }
        try {
          if (current === "pin") {
            const pin = window.prompt("Pro vypnutí zamykání zadejte současný PIN:");
            if (pin == null) return;
            await vault.disableMindMenuLock(pin);
          } else {
            await vault.disableMindMenuLock();
          }
          say("Zamykání MindMenu bylo vypnuto.");
          await notifySecurityChanged(vault);
        } catch (e) {
          say(String(e.message || e));
        }
        return;
      }

      if (current !== "none" && !st.unlocked) {
        say("Nejdříve odemkněte osobní data současnou metodou, poté změňte způsob odemknutí.");
        return;
      }

      if (target === "pin") {
        const input = showPinSetupDialog();
        if (!input) return;
        try {
          await vault.setupPin(input.pin, input.confirm);
          say("Zamykání MindMenu bylo zapnuto pomocí PINu.");
          await notifySecurityChanged(vault);
        } catch (e) {
          say(String(e.message || e));
        }
        return;
      }

      if (target === "device") {
        const btn = document.getElementById("iuVaultApplyMindMenuMethodBtn");
        if (btn) btn.disabled = true;
        say("Probíhá nastavení zabezpečení zařízením. Dokončete ověření ve Windows.");
        try {
          await vault.setupDevice();
          say("Zamykání MindMenu bylo zapnuto pomocí zabezpečení zařízení.");
          await notifySecurityChanged(vault);
        } catch (e) {
          say(deviceSetupUserMessage(e));
          await refreshSecurityUi();
        } finally {
          if (btn) btn.disabled = false;
        }
      }
    });

    document.getElementById("iuVaultDisableMindMenuLockBtn")?.addEventListener("click", async () => {
      const { method } = await readUnlockState(vault);
      if (method === "none") return;
      try {
        if (method === "pin") {
          const pin = window.prompt("Pro vypnutí zamykání zadejte současný PIN:");
          if (pin == null) return;
          await vault.disableMindMenuLock(pin);
        } else {
          await vault.disableMindMenuLock();
        }
        say("Zamykání MindMenu bylo vypnuto.");
        await notifySecurityChanged(vault);
      } catch (e) {
        say(String(e.message || e));
      }
    });

    document.getElementById("iuVaultChangePinBtn")?.addEventListener("click", async () => {
      const oldP = window.prompt("Současný PIN:");
      if (oldP == null) return;
      const input = showPinSetupDialog();
      if (!input) return;
      try {
        await vault.changePin(oldP, input.pin, input.confirm);
        say("PIN byl změněn.");
        await notifySecurityChanged(vault);
      } catch (e) {
        say(String(e.message || e));
      }
    });

    document.getElementById("iuVaultAutoLockSelect")?.addEventListener("change", async (ev) => {
      await vault.setAutoLockPolicy(ev.target.value);
      say("Nastavení automatického zamknutí uloženo.");
    });

    document.getElementById("iuVaultLockNowBtn")?.addEventListener("click", async () => {
      const { method } = await readUnlockState(vault);
      if (method === "none") {
        say("Zamknutí je dostupné až po zapnutí zamykání MindMenu.");
        return;
      }
      await vault.lock();
      await refreshSecurityUi();
    });

    document.getElementById("iuVaultUnlockPinBtn")?.addEventListener("click", async () => {
      const pin = document.getElementById("iuVaultPinInput")?.value || "";
      const err = document.getElementById("iuVaultLockErr");
      try {
        await vault.unlockPin(pin);
        await vault.afterUnlock();
        if (err) err.textContent = "";
        const inp = document.getElementById("iuVaultPinInput");
        if (inp) inp.value = "";
        await refreshSecurityUi();
      } catch (e) {
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
        await refreshSecurityUi();
      } catch (e) {
        const code = String(e && e.message ? e.message : e);
        if (code.includes("VAULT_DEVICE_CANCELLED")) {
          if (err) err.textContent = "Odemknutí bylo zrušeno. MindMenu zůstává zamčen.";
        } else if (code.includes("VAULT_DEVICE_TIMEOUT")) {
          if (err) err.textContent = "Vypršel časový limit. Zkuste odemknutí znovu.";
        } else {
          if (err) err.textContent = "Odemknutí zařízením se nezdařilo.";
        }
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

    window.addEventListener("iu-vault-locked", () => refreshSecurityUi());
    window.addEventListener("iu-vault-unlocked", () => refreshSecurityUi());
    window.addEventListener("iu-vault-security-changed", () => refreshSecurityUi());
  }

  async function ensureSecurityUi() {
    if (!injectSecuritySection()) return;
    await bindEvents();
    await refreshSecurityUi();
  }

  function init() {
    ensureLockOverlay();
    bindMindMenuGateEvents().catch(() => {});
    installDesktopMindMenuHook();
    ensureSecurityUi().catch(() => {});
    document.addEventListener("iu:info-center-mounted", () => {
      ensureSecurityUi().catch(() => {});
    });
    document.addEventListener(
      "click",
      (e) => {
        try {
          const t =
            e.target && e.target.closest
              ? e.target.closest('[data-iu-info-section="privacy"], [data-iu-info-goto="privacy"]')
              : null;
          if (!t) return;
          setTimeout(() => ensureSecurityUi().catch(() => {}), 0);
        } catch (_) {}
      },
      true
    );
    try {
      if (document.getElementById("iuInfoCenterDetailPrivacy")) {
        ensureSecurityUi().catch(() => {});
      } else {
        const obs = new MutationObserver(() => {
          if (document.getElementById("iuInfoCenterDetailPrivacy")) {
            obs.disconnect();
            ensureSecurityUi().catch(() => {});
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
