#!/usr/bin/env node
/**
 * Phase 3P — exact Forpsi IMAP operator runbook (no secrets printed, no connect).
 * Exit 0 always: BLOCKED is expected until user authorizes.
 */
import {
  assertForpsiImapLiveConnectAllowed,
  readForpsiImapCredentialSourceMeta,
  readForpsiImapLinuxRuntimeHints,
} from "./iu-forpsi-imap-credentials-interface.mjs";
import { diagnoseForpsiEmailChannel, runMockEmailMatrix } from "./iu-cj-affiliate-phase3m-email-hint-v1.mjs";

const meta = readForpsiImapCredentialSourceMeta();
const gate = assertForpsiImapLiveConnectAllowed();
const hints = readForpsiImapLinuxRuntimeHints();
const channel = diagnoseForpsiEmailChannel();
const mock = runMockEmailMatrix();

const out = {
  schema: "iu-cj-affiliate-phase3p-forpsi-operator-runbook-v1",
  liveEnabled: false,
  publishArmed: false,
  status: gate.ok ? "READY_FOR_OPERATOR_CONNECT" : "BLOCKED",
  reason: gate.reason || null,
  credentialsPresent: { hasUser: meta.hasUser, hasSecret: meta.hasSecret, source: meta.source },
  mockOk: mock.OK === true,
  authority: "CJ_API_ONLY",
  mailboxes: channel.mailboxes,
  imap: {
    host: "imap.forpsi.com",
    tls: "TLS required (IMAPS typically port 993 — confirm in Forpsi webmail/panel)",
    auth: "least-privilege IMAP login; prefer app-specific password if Forpsi offers it",
  },
  whereImapRunsWithoutPcOn: {
    primary: "GitHub Actions workflow cj-affiliate-email-ingest.yml (scheduled, gated)",
    alternate: "Existing Linux host / VPS with EnvironmentFile — not a new paid service",
    notRequired: "Local Windows PC does not need to stay on",
  },
  stepByStep: [
    {
      step: 1,
      title: "Confirm mailbox layout",
      actions: [
        "In Forpsi customer panel open mail for info@infouzel.cz",
        "Confirm whether affiliate@infouzel.cz is alias/forward to info@ or a separate mailbox",
        "Note IMAP server host (expect imap.forpsi.com) and TLS/IMAPS enabled",
      ],
    },
    {
      step: 2,
      title: "Create least-privilege IMAP credentials",
      actions: [
        "Create/reset mailbox password for the account that receives CJ mail",
        "Do NOT paste the password into chat, PR comments, or commit messages",
        "Prefer a dedicated IMAP user if Forpsi allows limited access",
      ],
    },
    {
      step: 3,
      title: "Store secrets safely (GitHub Actions — preferred 24/7)",
      actions: [
        "GitHub → repo Settings → Secrets and variables → Actions → New repository secret",
        "Add IU_FORPSI_IMAP_USER = mailbox login (e.g. info@infouzel.cz) — value never shown in logs by design",
        "Add IU_FORPSI_IMAP_SECRET = password/app password",
        "Optionally IU_FORPSI_IMAP_CREDENTIAL_SOURCE = process_env",
        "Do NOT set IU_FORPSI_IMAP_CONNECT_APPROVED yet",
      ],
    },
    {
      step: 4,
      title: "Optional local/Linux store (diagnostics only)",
      actions: [
        "Windows: load via DPAPI helper into process env (parent process only)",
        "Linux: write " + hints.suggestedEnvFile + " mode 600 with USER/SECRET keys only",
        "Never commit .env / EnvironmentFile into git",
      ],
    },
    {
      step: 5,
      title: "Explicit connect approval (ONLY after review)",
      actions: [
        "After YOU approve live IMAP, set GitHub Actions variable OR secret IU_FORPSI_IMAP_CONNECT_APPROVED=1",
        "Same key locally: export IU_FORPSI_IMAP_CONNECT_APPROVED=1 in the secure runtime only",
        "Agent/CI must never set this for you",
      ],
    },
    {
      step: 6,
      title: "Verify TLS + read path",
      actions: [
        "Run workflow cj-affiliate-email-ingest.yml (workflow_dispatch) after approval",
        "Expect secure IMAP connect, folder select, UID/Message-Id dedupe",
        "Only CJ-relevant subjects/senders are hinted; HTML/attachments sanitized",
        "Confirm logs never print password or full message bodies",
      ],
    },
    {
      step: 7,
      title: "Authority boundary",
      actions: [
        "Email may only emit EMAIL_HINT_REQUIRES_CJ_RECONCILE",
        "Partner add/remove/ENDED must be confirmed via CJ API catalog sync",
        "No catalog mutation from email alone",
      ],
    },
    {
      step: 8,
      title: "Failure / recovery",
      actions: [
        "Auth fail / TLS fail / mailbox unavailable → workflow fails or reports BLOCKED; keep partner LKG",
        "Fix credentials in Secrets (rotate if leaked suspicion)",
        "Unset CONNECT_APPROVED=1 to halt live connects immediately",
        "Re-run checklist: node scripts/iu-cj-affiliate-phase3p-forpsi-operator-runbook-v1.mjs",
      ],
    },
  ],
  leakPrevention: [
    "Secrets only in GitHub Secrets / EnvironmentFile / DPAPI — never in repo",
    "Workflow must redact IU_FORPSI_IMAP_SECRET from logs",
    "Do not echo env or dump raw MIME to artifacts",
    "PR/chat: never paste passwords",
  ],
  nextUserAction:
    "Provide IMAP credentials into GitHub Secrets, confirm affiliate@ alias, then set IU_FORPSI_IMAP_CONNECT_APPROVED=1 when ready",
};
console.log(JSON.stringify(out, null, 2));
process.exit(0);
