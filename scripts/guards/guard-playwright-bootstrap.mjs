/**
 * Shared Playwright guard bootstrap — pre-accept local data protection notice
 * so CI guards are not blocked by the one-time LDP dialog overlay.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  installLocalDataProtectionAccepted,
  installProofGuardNetworkStubs,
} = require("../proofs/open_meteo_guard_stub.cjs");

export { installLocalDataProtectionAccepted, installProofGuardNetworkStubs };

export async function installGuardWebAuthnStub(context) {
  if (!context || typeof context.addInitScript !== "function") return;
  await context.addInitScript(() => {
    if (!window.PublicKeyCredential) return;
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    PublicKeyCredential.getClientCapabilities = async () => ({ "extension:prf": true });
  });
}

export async function bootstrapGuardContext(browser, contextOptions = {}) {
  const playwrightOptions = { ...contextOptions };
  delete playwrightOptions.webauthnStub;
  delete playwrightOptions.isMobile;
  const context = await browser.newContext(playwrightOptions);
  await installLocalDataProtectionAccepted(context);
  if (contextOptions.webauthnStub === true) {
    await installGuardWebAuthnStub(context);
  }
  return context;
}

export async function bootstrapGuardPage(context) {
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  return page;
}

export async function waitForVaultReady(page, timeoutMs = 120000) {
  await page.waitForFunction(() => {
    try {
      return !!(window.iuVault && window.iuVault.getState && window.iuVault.getState().unlocked);
    } catch (_) {
      return false;
    }
  }, null, { timeout: timeoutMs });
}

export async function installProtectedStorageSeed(context, seeds) {
  if (!context || typeof context.addInitScript !== "function") return;
  await context.addInitScript((entries) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      for (const item of entries) {
        localStorage.setItem(item.key, item.value);
      }
    } catch (_) {}
  }, seeds);
}
