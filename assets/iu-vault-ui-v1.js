/**
 * Vault UI — Informační centrum + lock screen.
 */
(function iuVaultUiModule() {
  "use strict";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s || "");
    return d.innerHTML;
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

  function injectSecuritySection() {
    const panel = document.getElementById("iuInfoCenterDetailPrivacy");
    if (!panel || panel.querySelector("#iuVaultSecuritySection")) return;
    const inner = panel.querySelector(".iuInfoCenter__detailInner");
    if (!inner) return;
    const footer = inner.querySelector(".iuInfoCenter__meta");
    const section = document.createElement("section");
    section.id = "iuVaultSecuritySection";
    section.className = "iuVaultSecurity";
    section.innerHTML = [
      '<h3 class="iuInfoCenter__h3">Zabezpečení osobních dat</h3>',
      '<div class="iuVaultSecurity__level" data-iu-vault-level="1">',
      '  <h4 class="iuVaultSecurity__title">1. Standardní ochrana</h4>',
      '  <p class="iuInfoCenter__p">Vaše osobní údaje jsou automaticky šifrovány a zůstávají pouze v tomto prohlížeči. Při otevření osobních nástrojů nemusíte nic zadávat.</p>',
      '  <p class="iuVaultSecurity__status" id="iuVaultLevel1Status">Stav: <strong>Aktivní</strong></p>',
      "</div>",
      '<div class="iuVaultSecurity__level" data-iu-vault-level="2">',
      '  <h4 class="iuVaultSecurity__title">2. Odemknutí zařízením</h4>',
      '  <p class="iuInfoCenter__p">Osobní data se odemknou pomocí zabezpečení vašeho zařízení. Podle zařízení můžete použít Face ID, Touch ID, otisk prstu, Windows Hello nebo systémový kód zařízení.</p>',
      '  <p class="iuVaultSecurity__unsupported" id="iuVaultDeviceUnsupported" hidden>Toto zařízení nebo prohlížeč nyní bezpečné odemykání zařízením nepodporuje. Můžete použít vlastní PIN.</p>',
      '  <button type="button" class="iuInfoCenter__btn" id="iuVaultEnableDeviceBtn" hidden>Zapnout odemknutí zařízením</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultDisableDeviceBtn" hidden>Vypnout odemknutí zařízením</button>',
      "</div>",
      '<div class="iuVaultSecurity__level" data-iu-vault-level="3">',
      '  <h4 class="iuVaultSecurity__title">3. Vlastní PIN InfoUzlu</h4>',
      '  <p class="iuInfoCenter__p">Osobní data se odemknou pomocí PINu, který znáte pouze vy. PIN ani vaše osobní data InfoUzel neuchovává.</p>',
      '  <button type="button" class="iuInfoCenter__btn" id="iuVaultSetupPinBtn">Nastavit vlastní PIN</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultChangePinBtn" hidden>Změnit PIN</button>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultDisablePinBtn" hidden>Vypnout PIN</button>',
      "</div>",
      '<div class="iuVaultSecurity__auto">',
      '  <h4 class="iuVaultSecurity__title">Automatické zamknutí</h4>',
      '  <select id="iuVaultAutoLockSelect" class="iuVaultSecurity__select" aria-label="Automatické zamknutí">',
      '    <option value="manual">Pouze ručně</option>',
      '    <option value="background">Při návratu z pozadí</option>',
      '    <option value="idle_1m">Po 1 minutě nečinnosti</option>',
      '    <option value="idle_5m">Po 5 minutách nečinnosti</option>',
      '    <option value="idle_15m">Po 15 minutách nečinnosti</option>',
      '  </select>',
      '  <button type="button" class="iuInfoCenter__btn iuInfoCenter__btn--secondary" id="iuVaultLockNowBtn">Zamknout osobní data nyní</button>',
      "</div>",
      '<p class="iuVaultSecurity__msg" id="iuVaultSecurityMsg" aria-live="polite"></p>',
    ].join("");
    if (footer) inner.insertBefore(section, footer);
    else inner.appendChild(section);
  }

  function ensureLockOverlay() {
    if (document.getElementById("iuVaultLockOverlay")) return;
    const el = document.createElement("div");
    el.id = "iuVaultLockOverlay";
    el.className = "iuVaultLockOverlay";
    el.hidden = true;
    el.innerHTML = [
      '<div class="iuVaultLockOverlay__panel" role="dialog" aria-modal="true" aria-labelledby="iuVaultLockTitle">',
      '  <h2 id="iuVaultLockTitle" class="iuVaultLockOverlay__title">Osobní data jsou zamčena</h2>',
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

  async function refreshSecurityUi() {
    const vault = await waitVault();
    const meta = await vault.getMeta();
    const st = vault.getState();
    const deviceSupported = await vault.detectDeviceSupport();

    const l1 = document.getElementById("iuVaultLevel1Status");
    const pinBtn = document.getElementById("iuVaultSetupPinBtn");
    const changePin = document.getElementById("iuVaultChangePinBtn");
    const disablePin = document.getElementById("iuVaultDisablePinBtn");
    const devBtn = document.getElementById("iuVaultEnableDeviceBtn");
    const devOff = document.getElementById("iuVaultDisableDeviceBtn");
    const devNo = document.getElementById("iuVaultDeviceUnsupported");
    const autoSel = document.getElementById("iuVaultAutoLockSelect");

    const level = meta && meta.securityLevel === 23 ? 23 : (meta && meta.securityLevel) || 1;
    const pinOn = !!(meta && meta.pinEnabled);
    const devOn = !!(meta && meta.deviceEnabled);

    if (l1) {
      l1.innerHTML = level === 1 && !pinOn && !devOn
        ? 'Stav: <strong>Aktivní</strong>'
        : "Stav: <span>Doplňková základní ochrana (šifrování) zůstává vždy zapnutá</span>";
    }
    if (pinBtn) pinBtn.hidden = pinOn;
    if (changePin) changePin.hidden = !pinOn;
    if (disablePin) disablePin.hidden = !pinOn;
    if (devNo) devNo.hidden = deviceSupported;
    if (devBtn) devBtn.hidden = !deviceSupported || devOn;
    if (devOff) devOff.hidden = !devOn;
    if (autoSel && meta) autoSel.value = meta.autoLockPolicy || "background";

    const overlay = document.getElementById("iuVaultLockOverlay");
    if (overlay) {
      const needsLock = (pinOn || devOn) && !st.unlocked;
      overlay.hidden = !needsLock;
      document.getElementById("iuVaultPinInput").hidden = !pinOn;
      document.getElementById("iuVaultPinLabel").hidden = !pinOn;
      document.getElementById("iuVaultUnlockPinBtn").hidden = !pinOn;
      document.getElementById("iuVaultUnlockDeviceBtn").hidden = !devOn || !deviceSupported;
      document.getElementById("iuVaultForgotPinBtn").hidden = !pinOn;
    }
  }

  function showPinSetupDialog() {
    const warn = "PIN nelze obnovit. Pokud jej zapomenete a nebude dostupná jiná dříve nastavená metoda odemknutí, bude nutné vymazat osobní data uložená v tomto prohlížeči.";
    if (!window.confirm(warn)) return null;
    const pin = window.prompt("Zadejte PIN (min. 6 číslic):");
    if (pin == null) return null;
    const confirm = window.prompt("Zadejte PIN znovu pro potvrzení:");
    if (confirm == null) return null;
    return { pin, confirm };
  }

  async function bindEvents() {
    const vault = await waitVault();
    const msg = document.getElementById("iuVaultSecurityMsg");

    function say(text) {
      if (msg) msg.textContent = text || "";
    }

    document.getElementById("iuVaultSetupPinBtn")?.addEventListener("click", async () => {
      const input = showPinSetupDialog();
      if (!input) return;
      try {
        await vault.setupPin(input.pin, input.confirm);
        say("PIN byl nastaven.");
        await refreshSecurityUi();
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
      } catch (e) {
        say(String(e.message || e));
      }
    });

    document.getElementById("iuVaultDisablePinBtn")?.addEventListener("click", async () => {
      const pin = window.prompt("Pro vypnutí PINu zadejte současný PIN:");
      if (pin == null) return;
      try {
        await vault.disablePin(pin);
        await vault.afterUnlock();
        say("PIN byl vypnut.");
        await refreshSecurityUi();
      } catch (e) {
        say(String(e.message || e));
      }
    });

    document.getElementById("iuVaultEnableDeviceBtn")?.addEventListener("click", async () => {
      try {
        await vault.setupDevice();
        say("Odemknutí zařízením bylo zapnuto.");
        await refreshSecurityUi();
      } catch (e) {
        say(String(e.message || e));
      }
    });

    document.getElementById("iuVaultDisableDeviceBtn")?.addEventListener("click", async () => {
      try {
        await vault.disableDevice();
        await vault.afterUnlock();
        say("Odemknutí zařízením bylo vypnuto.");
        await refreshSecurityUi();
      } catch (e) {
        say(String(e.message || e));
      }
    });

    document.getElementById("iuVaultAutoLockSelect")?.addEventListener("change", async (ev) => {
      await vault.setAutoLockPolicy(ev.target.value);
      say("Nastavení automatického zamknutí uloženo.");
    });

    document.getElementById("iuVaultLockNowBtn")?.addEventListener("click", async () => {
      const meta = await vault.getMeta();
      if (!meta.pinEnabled && !meta.deviceEnabled) {
        say("Automatické zamknutí je dostupné až po zapnutí PINu nebo odemknutí zařízením.");
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
      try {
        await vault.unlockDevice();
        await vault.afterUnlock();
        if (err) err.textContent = "";
        await refreshSecurityUi();
      } catch (e) {
        if (err) err.textContent = "Odemknutí zařízením se nezdařilo.";
      }
    });

    document.getElementById("iuVaultForgotPinBtn")?.addEventListener("click", async () => {
      const step1 = window.confirm(
        "PIN nelze obnovit.\n\nInfoUzel neuchovává váš PIN, šifrovací klíč ani kopii vašich osobních dat. Bez správného PINu nebo jiné dříve nastavené metody odemknutí nelze uložená data otevřít.\n\nPokračováním nenávratně odstraníte osobní data uložená v tomto prohlížeči."
      );
      if (!step1) return;
      const typed = window.prompt('Pro potvrzení napište přesně: VYMAZAT OSOBNÍ DATA');
      if (typed !== "VYMAZAT OSOBNÍ DATA") return;
      await vault.wipePersonal();
      window.location.reload();
    });

    window.addEventListener("iu-vault-locked", () => refreshSecurityUi());
    window.addEventListener("iu-vault-unlocked", () => refreshSecurityUi());
  }

  async function init() {
    injectSecuritySection();
    ensureLockOverlay();
    await bindEvents();
    await refreshSecurityUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init().catch(() => {}));
  } else {
    init().catch(() => {});
  }
})();
