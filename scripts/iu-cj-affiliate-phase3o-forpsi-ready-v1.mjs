#!/usr/bin/env node
/**
 * Phase 3O — Forpsi IMAP readiness (no secrets, no live connect unless approved).
 * Completes everything that does not require credentials. Exit 0 even when BLOCKED.
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
  schema: "iu-cj-affiliate-phase3o-forpsi-ready-v1",
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
  configVerifiedWithoutSecrets: {
    imapHostHint: "imap.forpsi.com",
    tlsRequired: true,
    preferredAuth: "least-privilege IMAP login (app password if available)",
    mailboxes: channel.mailboxes,
    aliasQuestion:
      "Confirm whether affiliate@infouzel.cz is an alias/forward to info@infouzel.cz or a separate mailbox",
    runtimeWithoutAlwaysOnPc: [
      "Prefer GitHub Actions scheduled ingest OR a small always-on host/VPS already in use",
      "Do not buy a new paid service solely for IMAP polling without explicit approval",
      "Local Windows PC is optional diagnostic only — not required for 24/7",
    ],
    secretStorage: [
      "Windows: DPAPI / local secret store loaded into env by parent process",
      "Linux: " + hints.suggestedEnvFile + " (mode 600) or secret mount",
      "GitHub Actions secrets: IU_FORPSI_IMAP_USER + IU_FORPSI_IMAP_SECRET (never commit)",
    ],
    leastPrivilege: [
      "Mailbox login limited to IMAP read",
      "No SMTP send rights required",
      "Restrict who can read Actions secrets / env files",
    ],
    dedupeIdempotency: [
      "Message-Id + IMAP UID dedupe in ingest pipeline",
      "Repeated runs must emit hints only — no catalog mutation",
    ],
    monitoring: [
      "Treat empty poll vs auth failure separately",
      "On mailbox unavailable: keep LKG partners; do not ENDED from email alone",
      "Alert on repeated auth/network failures (workflow conclusion + logs)",
    ],
  },
  mockEmailMatrixOk: mock.OK === true,
  mutatePartners: false,
  authority: "CJ_API_ONLY",
  operatorAuthSteps: [
    "1) In Forpsi panel confirm info@infouzel.cz IMAP/TLS and whether affiliate@ is alias or mailbox.",
    "2) Create least-privilege IMAP credentials (do not paste password into chat).",
    "3) Store secrets via DPAPI/EnvironmentFile/GitHub Secrets — never in git.",
    "4) Export IU_FORPSI_IMAP_USER, IU_FORPSI_IMAP_SECRET, IU_FORPSI_IMAP_CREDENTIAL_SOURCE.",
    "5) After review set IU_FORPSI_IMAP_CONNECT_APPROVED=1 in the same secure runtime only.",
    "6) Re-run: node scripts/iu-cj-affiliate-phase3o-forpsi-ready-v1.mjs",
    "7) Live poll may only produce EMAIL_HINT_REQUIRES_CJ_RECONCILE; reconcile via CJ API.",
  ],
};
console.log(JSON.stringify(out, null, 2));
process.exit(0);
