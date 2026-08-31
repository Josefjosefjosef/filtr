/**
 * Vault UI — Informační centrum + globální app lock (L2/L3).
 */
(function iuVaultUiModule() {
  "use strict";

  let eventsBound = false;
  let mindMenuGateBound = false;
  let desktopHookTimer = null;
  let methodPickerOpen = false;
  let pickerDraftMethod = null;
  let autoDeviceUnlockToken = 0;

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
      '  <h4 class="iuVaultSecurity__title">Odemknutí zařízením</h4>',
      '  <p class="iuInfoCenter__p">Po aktivaci bude InfoUzel při novém otevření vyžadovat ověření pomocí zabezpečení tohoto zařízení. Na Windows může systém použít Windows Hello PIN, otisk prstu nebo rozpoznání obličeje. Na podporovaných mobilních zařízeních může být použito Face ID, Touch ID, otisk prstu nebo jiná systémová autentizace.</p>',
      '  <p class="iuVaultSecurity__current" id="iuVaultMindMenuLockStatus" aria-live="polite"></p>',
      '  <p class="iuVaultSecurity__currentBackup" id="iuVaultMindMenuUnlockMethodLabel" aria-live="polite"></p>',
      '  <fieldset class="iuVaultSecurity__methodFieldset" id="iuVaultMindMenuMethodFieldset">',
      '    <legend class="iuVaultSecurity__legend">Způsob odemknutí</legend>',
      '    <label class="iuVaultSecurity__radio"><input type="radio" name="iuVaultMindMenuMethod" value="none" /> Bez dalšího zamykání</label>',
      '    <label class="iuVaultSecurity__radio" id="iuVaultMindMenuMethodDeviceLabel"><input type="radio" name="iuVaultMindMenuMethod" value="device" /> Zabezpečení zařízení — doporučeno</label>',
      '    <label class="iuVaultSecurity__radio"><input type="radio" name="iuVaultMindMenuMethod" value="pin" /> Vlastní PIN InfoUzlu</label>',
      "  </fieldset>",
      '  <div class="iuVaultSecurity__pinSetup" id="iuVaultPinSetupBlock" hidden>',
      '    <p class="iuVaultSecurity__pinSetupHint" id="iuVaultPinSetupHint">PIN musí mít alespoň 6 číslic (0–9). Vlastní PIN může mít 6 a více číslic — 6 je minimum, ne maximální délka.</p>',
      '    <p class="iuInfoCenter__p iuVaultSecurity__pinSetupGuidance">Pro vyšší zabezpečení doporučujeme použít delší, náhodný a obtížně odhadnutelný PIN. Čím delší a méně předvídatelný PIN zvolíte, tím vyšší je odolnost uložených dat proti pokusům o jeho prolomení. Nepoužívejte datum narození, jednoduché číselné řady, opakující se číslice ani jiné snadno zjistitelné údaje. Pro vyšší úroveň ochrany doporučujeme zabezpečení prostřednictvím zařízení, pokud jej vaše zařízení podporuje.</p>',
      '    <label class="iuVaultSecurity__pinSetupLabel" for="iuVaultPinSetupNew">Nový PIN InfoUzlu</label>',
      '    <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false" class="iuVaultSecurity__input iuVaultSecurity__input--pin" id="iuVaultPinSetupNew" />',
      '    <label class="iuVaultSecurity__pinSetupLabel" for="iuVaultPinSetupConfirm">Potvrzení PINu</label>',
      '    <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false" class="iuVaultSecurity__input iuVaultSecurity__input--pin" id="iuVaultPinSetupConfirm" />',
      "  </div>",
      '  <p class="iuVaultSecurity__unsupported" id="iuVaultDeviceUnsupported" hidden>Zabezpečení zařízením není v tomto prohlížeči podporováno. Na mobilu použijte nainstalovanou PWA aplikaci InfoUzlu, nebo zvolte vlastní PIN InfoUzlu.</p>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--primary" id="iuVaultApplyMindMenuMethodBtn">Aktivovat zabezpečení InfoUzlu</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultChangePinBtn" hidden>Změnit PIN</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultChangeMindMenuMethodBtn" hidden>Změnit způsob odemknutí</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--danger" id="iuVaultDisableMindMenuLockBtn" hidden>Vypnout zabezpečení InfoUzlu</button>',
      '  <div class="iuVaultSecurity__auto" id="iuVaultAutoLockBlock">',
      '    <h4 class="iuVaultSecurity__title">Automaticky zamknout</h4>',
      '    <select id="iuVaultAutoLockSelect" class="iuVaultSecurity__select" aria-label="Automatické zamknutí">',
      '      <option value="manual">Pouze ručně</option>',
      '      <option value="background">Při návratu z pozadí</option>',
      '      <option value="idle_1m">Po 1 minutě nečinnosti</option>',
      '      <option value="idle_5m">Po 5 minutách nečinnosti</option>',
      '      <option value="idle_15m">Po 15 minutách nečinnosti</option>',
      "    </select>",
      '    <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultLockNowBtn">Zamknout InfoUzel</button>',
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
    return checked ? String(checked.value || "none") : pickerDraftMethod || "none";
  }

  function syncPickerDraftFromUi() {
    const selected = selectedMethodFromUi();
    if (selected) pickerDraftMethod = selected;
    return pickerDraftMethod;
  }

  function setMethodRadios(method) {
    const value = method || "none";
    document.querySelectorAll('input[name="iuVaultMindMenuMethod"]').forEach((el) => {
      el.checked = el.value === value;
    });
    pickerDraftMethod = value;
  }

  function ensureLockOverlay() {
    /* Global lock screen lives in index.html (#iuVaultAppLockScreen). */
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
        '  <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false" class="iuVaultMindMenuLockGate__input iuVaultSecurity__input--pin" id="iuVaultMindMenuPinInput" hidden>',
        '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--primary" id="iuVaultMindMenuUnlockPinBtn" hidden>Odemknout PINem</button>',
        '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--primary" id="iuVaultMindMenuUnlockDeviceBtn" hidden>Odemknout zařízením</button>',
        '  <p class="iuVaultMindMenuLockGate__err" id="iuVaultMindMenuLockErr" aria-live="polite"></p>',
        "</div>",
      ].join("");
      scroll.insertBefore(gate, scroll.firstChild);
    }
    return gate;
  }

  async function refreshMindMenuLockGate() {
    /* MindMenu-only gate retired — global app lock handles L2/L3. */
    hideMindMenuLockGate();
  }

  function hideMindMenuLockGate() {
    const gate = document.getElementById("iuVaultMindMenuLockGate");
    if (gate) gate.hidden = true;
    const host = document.getElementById("iuMyInfoUzelMindMenuHost");
    const toolsHost = document.getElementById("iuMyInfoUzelToolsHost");
    if (host) host.hidden = false;
    if (toolsHost) toolsHost.hidden = false;
  }

  async function showDesktopMindMenuLockGate(options) {
    const opts = options || {};
    const { meta, st, method } = await vaultNeedsUserUnlock();
    if (opts.autoDevice && method === "device" && !st.unlocked) {
      window.__iuVaultPendingAutoDeviceUnlock = true;
    }
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
    /* Global app lock — no MindMenu-only defer hook. */
  }

  async function bindMindMenuGateEvents() {
    /* Unlock handlers bound in iu-vault-app-lock-v1.js at bootstrap. */
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
    const pinSetupBlock = document.getElementById("iuVaultPinSetupBlock");
    const draftMethod = pickerDraftMethod || method;

    if (statusEl) {
      statusEl.innerHTML =
        method === "none"
          ? "Zabezpečení InfoUzlu: <strong>Vypnuto</strong>"
          : "✓ InfoUzel je chráněn při otevření";
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
      applyBtn.textContent = active ? "Použít nový způsob odemknutí" : "Aktivovat zabezpečení InfoUzlu";
    }
    if (changePin) changePin.hidden = method !== "pin" || methodPickerOpen;
    if (changeMethod) changeMethod.hidden = !active || methodPickerOpen;
    if (disableLock) disableLock.hidden = !active || methodPickerOpen;
    if (autoBlock) autoBlock.hidden = method === "none";
    if (autoSel && meta) autoSel.value = meta.autoLockPolicy || "background";
    if (lockNow) lockNow.hidden = method === "none";

    if (devNo) devNo.hidden = deviceSupported || !showPicker;
    if (devLabel) {
      devLabel.hidden = !deviceSupported && showPicker;
      devLabel.style.pointerEvents = deviceSupported ? "" : "none";
    }
    if (fieldset && showPicker) {
      setMethodRadios(methodPickerOpen ? draftMethod : method);
      fieldset.disabled = false;
      fieldset.removeAttribute("aria-disabled");
    }
    if (pinSetupBlock) {
      pinSetupBlock.hidden = !(showPicker && draftMethod === "pin");
    }

    if (vault.refreshAppLockUi) await vault.refreshAppLockUi();
    await refreshMindMenuLockGate();
  }

  function showPinSetupDialog() {
    const warn =
      "PIN nelze obnovit. Pokud jej zapomenete, nebude možné uložená osobní data otevřít. V takovém případě bude nutné osobní data v tomto prohlížeči vymazat.";
    if (!window.confirm(warn)) return null;
    const pin = window.prompt("Zadejte PIN (min. 6 číslic, pouze 0–9):");
    if (pin == null) return null;
    const confirmPin = window.prompt("Zadejte PIN znovu pro potvrzení:");
    if (confirmPin == null) return null;
    return { pin, confirm: confirmPin };
  }

  function pinSetupUserMessage(err) {
    const code = String(err && err.message ? err.message : err);
    if (code.startsWith("VAULT_PIN_WEAK|invalid_format") || code.startsWith("VAULT_PIN_WEAK|")) {
      return "PIN musí mít alespoň 6 číslic (pouze číslice 0–9).";
    }
    if (code.includes("VAULT_PIN_MISMATCH")) return "PIN a potvrzení se neshodují.";
    return code;
  }

  function deviceSetupUserMessage(err) {
    const code = String(err && err.message ? err.message : err);
    const stepMatch = code.match(/step:([0-9]{2}-[a-z0-9-]+)/);
    const errNameMatch = code.match(/error\.name:([^|]+)/);
    const opMatch = code.match(/operation:([^|]+)/);
    const keyMatch = code.match(/recordKey:([^|]+)/);
    const phaseMatch = code.match(/^(DEVICE_[A-Z0-9_]+)/);
    if (phaseMatch) {
      const phase = phaseMatch[1];
      const step = stepMatch ? stepMatch[1] : "";
      const errName = errNameMatch ? errNameMatch[1] : "";
      const op = opMatch ? opMatch[1] : "";
      const key = keyMatch ? keyMatch[1] : "";
      const parts = [phase];
      if (step) parts.push(`krok ${step}`);
      if (errName) parts.push(errName);
      if (op) parts.push(op);
      if (key) parts.push(`key:${key}`);
      return `Nastavení zabezpečení zařízením se nezdařilo (${parts.join(", ")}).`;
    }
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

  function setDeviceSetupBusy(busy) {
    // Only disable the setup/apply controls — never the global lock-screen unlock
    // button (PWA/iOS can leave it stuck disabled across background/Face ID).
    const applyBtn = document.getElementById("iuVaultApplyMindMenuMethodBtn");
    const mindMenuDev = document.getElementById("iuVaultMindMenuUnlockDeviceBtn");
    if (applyBtn) applyBtn.disabled = !!busy;
    if (mindMenuDev) mindMenuDev.disabled = !!busy;
  }

  async function notifySecurityChanged(vault) {
    try {
      if (vault.flushPendingWrites) await vault.flushPendingWrites();
    } catch (_) {}
    methodPickerOpen = false;
    pickerDraftMethod = null;
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
      pickerDraftMethod = method;
      setMethodRadios(method);
      await refreshSecurityUi();
    });

    document.getElementById("iuVaultMindMenuMethodFieldset")?.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t || t.name !== "iuVaultMindMenuMethod") return;
      methodPickerOpen = true;
      pickerDraftMethod = String(t.value || "none");
      const pinSetupBlock = document.getElementById("iuVaultPinSetupBlock");
      if (pinSetupBlock) pinSetupBlock.hidden = pickerDraftMethod !== "pin";
      const msg = document.getElementById("iuVaultSecurityMsg");
      if (msg) msg.textContent = "";
    });

    document.getElementById("iuVaultMindMenuMethodFieldset")?.addEventListener("click", (ev) => {
      const label = ev.target && ev.target.closest ? ev.target.closest("label.iuVaultSecurity__radio") : null;
      if (!label) return;
      methodPickerOpen = true;
      const input = label.querySelector('input[name="iuVaultMindMenuMethod"]');
      if (input) {
        pickerDraftMethod = String(input.value || "none");
        input.checked = true;
        const pinSetupBlock = document.getElementById("iuVaultPinSetupBlock");
        if (pinSetupBlock) pinSetupBlock.hidden = pickerDraftMethod !== "pin";
      }
    });

    document.getElementById("iuVaultApplyMindMenuMethodBtn")?.addEventListener("click", async () => {
      syncPickerDraftFromUi();
      const target = pickerDraftMethod || selectedMethodFromUi();
      const { method: current, st } = await readUnlockState(vault);

      if (target === current && target !== "none") {
        methodPickerOpen = false;
        await refreshSecurityUi();
        return;
      }

        if (target === "none") {
        if (current === "none") {
          say("Zabezpečení InfoUzlu je již vypnuto.");
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
          say("Zabezpečení InfoUzlu bylo vypnuto.");
          await notifySecurityChanged(vault);
        } catch (e) {
          say(String(e.message || e));
        }
        return;
      }

      if (current !== "none" && !st.unlocked) {
        say("Nejdříve odemkněte InfoUzel současnou metodou, poté změňte způsob odemknutí.");
        return;
      }

      if (target === "pin") {
        if (!window.confirm(
          "PIN nelze obnovit. Pokud jej zapomenete, nebude možné uložená osobní data otevřít. V takovém případě bude nutné osobní data v tomto prohlížeči vymazat."
        )) {
          return;
        }
        const pinNew = document.getElementById("iuVaultPinSetupNew");
        const pinConfirm = document.getElementById("iuVaultPinSetupConfirm");
        const pin = pinNew ? String(pinNew.value || "") : "";
        const confirmPin = pinConfirm ? String(pinConfirm.value || "") : "";
        if (!pin || !confirmPin) {
          say("Vyplňte nový PIN i potvrzení PINu.");
          const pinSetupBlock = document.getElementById("iuVaultPinSetupBlock");
          if (pinSetupBlock) pinSetupBlock.hidden = false;
          return;
        }
        if (pin !== confirmPin) {
          say("PIN a potvrzení se neshodují.");
          return;
        }
        const pinReject = vault.validatePinPolicy ? vault.validatePinPolicy(pin) : null;
        if (pinReject) {
          say(pinSetupUserMessage(new Error(`VAULT_PIN_WEAK|${pinReject}`)));
          return;
        }
        try {
          await vault.setupPin(pin, confirmPin);
          if (pinNew) pinNew.value = "";
          if (pinConfirm) pinConfirm.value = "";
          say("InfoUzel je nyní chráněn pomocí PINu.");
          await notifySecurityChanged(vault);
        } catch (e) {
          say(pinSetupUserMessage(e));
        }
        return;
      }

      if (target === "device") {
        setDeviceSetupBusy(true);
        say("Probíhá nastavení zabezpečení zařízením. Dokončete ověření ve Windows.");
        try {
          await vault.setupDevice();
          say("InfoUzel je nyní chráněn pomocí zabezpečení zařízení.");
          await notifySecurityChanged(vault);
        } catch (e) {
          say(deviceSetupUserMessage(e));
          await refreshSecurityUi();
        } finally {
          setDeviceSetupBusy(false);
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
        say("Zamknutí je dostupné až po aktivaci zabezpečení InfoUzlu.");
        return;
      }
      await vault.lock();
      if (vault.refreshAppLockUi) await vault.refreshAppLockUi();
      await refreshSecurityUi();
    });

    window.addEventListener("iu-vault-locked", () => refreshSecurityUi());
    window.addEventListener("iu-vault-unlocked", () => refreshSecurityUi());
    window.addEventListener("iu-vault-security-changed", () => refreshSecurityUi());
  }

  async function ensureSecurityUi() {
    if (!injectSecuritySection()) return;
    if (pickerDraftMethod == null) pickerDraftMethod = "none";
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
