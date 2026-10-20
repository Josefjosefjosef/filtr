#!/usr/bin/env node
/**
 * Credential source contract for CJ import scripts (no secrets here).
 * - local_dpapi: parent PowerShell decrypts PAT and sets process env for this run only.
 * - infra: future CI/host injects IU_CJ_PAT / CID / PID from platform secret store (not DPAPI).
 * Node importers read only env via loadCjEnv(); they never read pat.dpapi directly.
 */
export const IU_CJ_CREDENTIAL_SOURCES = Object.freeze({
  process_env: "Env set by parent (default)",
  local_dpapi: "Windows PS parent loaded DPAPI store",
  infra: "Production secret store (future)",
});

export function readCjCredentialSourceMeta() {
  const raw = String(process.env.IU_CJ_CREDENTIAL_SOURCE || "process_env").trim();
  const known = Object.prototype.hasOwnProperty.call(IU_CJ_CREDENTIAL_SOURCES, raw);
  return {
    source: known ? raw : "process_env",
    knownSource: known,
    hasPat: Boolean(String(process.env.IU_CJ_PAT || process.env.CJ_PERSONAL_ACCESS_TOKEN || "").trim()),
    hasPublisherCid: Boolean(String(process.env.IU_CJ_PUBLISHER_CID || process.env.CJ_PUBLISHER_CID || "").trim()),
    hasWebsitePid: Boolean(String(process.env.IU_CJ_WEBSITE_PID || process.env.CJ_WEBSITE_PID || process.env.CJ_PID || "").trim()),
  };
}
