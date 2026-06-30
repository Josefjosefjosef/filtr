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

export async function bootstrapGuardContext(browser, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  await installLocalDataProtectionAccepted(context);
  return context;
}

export async function bootstrapGuardPage(context) {
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  return page;
}
