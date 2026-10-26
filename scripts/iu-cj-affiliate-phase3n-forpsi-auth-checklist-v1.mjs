#!/usr/bin/env node
/**
 * Phase 3N — Forpsi IMAP authorization checklist (no secrets, no connect).
 */
import {
  assertForpsiImapLiveConnectAllowed,
  readForpsiImapCredentialSourceMeta,
  readForpsiImapLinuxRuntimeHints,
} from "./iu-forpsi-imap-credentials-interface.mjs";
import { diagnoseForpsiEmailChannel } from "./iu-cj-affiliate-phase3m-email-hint-v1.mjs";

const meta = readForpsiImapCredentialSourceMeta();
const gate = assertForpsiImapLiveConnectAllowed();
const hints = readForpsiImapLinuxRuntimeHints();
const channel = diagnoseForpsiEmailChannel();

const out = {
  schema: "iu-cj-affiliate-phase3n-forpsi-auth-checklist-v1",
  liveEnabled: false,
  publishArmed: false,
  status: gate.ok ? "READY_FOR_OPERATOR_CONNECT" : "BLOCKED",
  reason: gate.reason || null,
  credentials: {
    source: meta.source,
    hasUser: meta.hasUser,
    hasSecret: meta.hasSecret,
    mailboxHint: meta.mailboxHint,
  },
  operatorSteps: [
    "1) Confirm info@infouzel.cz mailbox at Forpsi (and whether affiliate@ is alias or separate).",
    "2) Create least-privilege IMAP login (read-only if Forpsi allows) — do not paste password into chat/CI logs.",
    "3) Store via DPAPI/local secret store or Linux EnvironmentFile: " + hints.suggestedEnvFile,
    "4) Export only: IU_FORPSI_IMAP_USER, IU_FORPSI_IMAP_SECRET, IU_FORPSI_IMAP_CREDENTIAL_SOURCE.",
    "5) After review, set IU_FORPSI_IMAP_CONNECT_APPROVED=1 in the same secure runtime (not in git).",
    "6) Optionally add matching GitHub Actions secrets for scheduled ingest — still require CONNECT_APPROVED.",
    "7) Re-run: node scripts/iu-cj-affiliate-phase3n-forpsi-auth-checklist-v1.mjs",
    "8) Live poll must only emit EMAIL_HINT_REQUIRES_CJ_RECONCILE — never mutate catalog from email alone.",
  ],
  mailboxes: channel.mailboxes,
  imapHostHint: "imap.forpsi.com (TLS; confirm in Forpsi panel)",
  mutatePartners: false,
  authority: "CJ_API_ONLY",
};
console.log(JSON.stringify(out, null, 2));
/* Always 0: BLOCKED is an expected operator state, not a CI failure. */
process.exit(0);
