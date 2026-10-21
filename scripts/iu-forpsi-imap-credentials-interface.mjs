#!/usr/bin/env node
/** FORPSI IMAP credential contract — no secrets in repo; runtime env only. */
export const IU_FORPSI_IMAP_CREDENTIAL_SOURCES = Object.freeze({
  process_env: "Env set by parent process",
  local_dpapi: "Windows PS parent loaded DPAPI store",
  infra: "Future platform secret store",
});

export function readForpsiImapCredentialSourceMeta() {
  const raw = String(process.env.IU_FORPSI_IMAP_CREDENTIAL_SOURCE || "process_env").trim();
  const known = Object.prototype.hasOwnProperty.call(IU_FORPSI_IMAP_CREDENTIAL_SOURCES, raw);
  const user = String(process.env.IU_FORPSI_IMAP_USER || "").trim();
  const secret = String(process.env.IU_FORPSI_IMAP_SECRET || "").trim();
  return {
    source: known ? raw : "process_env",
    knownSource: known,
    hasUser: user.length > 0,
    hasSecret: secret.length > 0,
    mailboxHint: user.includes("@") ? user.toLowerCase() : null,
  };
}

/** Step B/C gate — live IMAP disabled unless operator explicitly approves connect. */
export function isForpsiImapLiveConnectApproved() {
  return String(process.env.IU_FORPSI_IMAP_CONNECT_APPROVED || "").trim() === "1";
}

/** Linux/server: inject via systemd EnvironmentFile or secret mount — never commit secrets. */
export function readForpsiImapLinuxRuntimeHints() {
  return {
    suggestedSecretDir: "/etc/infouzel/secrets/forpsi-imap",
    suggestedEnvFile: "/etc/infouzel/forpsi-imap.env",
    envKeys: ["IU_FORPSI_IMAP_USER", "IU_FORPSI_IMAP_SECRET", "IU_FORPSI_IMAP_CREDENTIAL_SOURCE"],
    connectApprovalKey: "IU_FORPSI_IMAP_CONNECT_APPROVED",
    dpapiWindowsOnly: true,
  };
}

export function assertForpsiImapLiveConnectAllowed() {
  if (!isForpsiImapLiveConnectApproved()) {
    return { ok: false, reason: "live_connect_not_approved", detail: "Set IU_FORPSI_IMAP_CONNECT_APPROVED=1 after operator approval" };
  }
  const meta = readForpsiImapCredentialSourceMeta();
  if (!meta.hasUser || !meta.hasSecret) {
    return { ok: false, reason: "credentials_missing", detail: "Configure IU_FORPSI_IMAP_USER and IU_FORPSI_IMAP_SECRET via secure store" };
  }
  return { ok: true, reason: null, detail: null };
}
