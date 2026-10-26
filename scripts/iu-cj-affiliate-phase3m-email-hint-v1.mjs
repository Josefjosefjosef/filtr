#!/usr/bin/env node
/**
 * Phase 3M — Forpsi/CJ email → lifecycle hint only (never mutates partners).
 * Live IMAP requires IU_FORPSI_IMAP_CONNECT_APPROVED=1 + secrets (operator).
 */
import {
  assertForpsiImapLiveConnectAllowed,
  readForpsiImapCredentialSourceMeta,
  isForpsiImapLiveConnectApproved,
} from "./iu-forpsi-imap-credentials-interface.mjs";
import { emailHintToLifecycleAction } from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";

export const EMAIL_CHANNEL_STATUS = Object.freeze({
  READY_MOCK: "READY_MOCK",
  LIVE_BLOCKED: "BLOCKED",
  LIVE_APPROVED: "LIVE_CONNECT_APPROVED",
});

export function diagnoseForpsiEmailChannel() {
  const creds = readForpsiImapCredentialSourceMeta();
  const liveGate = assertForpsiImapLiveConnectAllowed();
  const approved = isForpsiImapLiveConnectApproved();
  return {
    mailboxes: ["info@infouzel.cz", "affiliate@infouzel.cz"],
    affiliateMailboxNote:
      "Treat affiliate@ as alias-or-mailbox TBD; never use email alone for ENDED/ADD",
    imap: {
      protocol: "IMAP",
      credentialSource: creds.source,
      hasUser: creds.hasUser,
      hasSecret: creds.hasSecret,
      liveConnectApproved: approved,
      liveGateOk: liveGate.ok,
      liveGateReason: liveGate.reason || null,
    },
    status: liveGate.ok ? EMAIL_CHANNEL_STATUS.LIVE_APPROVED : EMAIL_CHANNEL_STATUS.LIVE_BLOCKED,
    mockStatus: EMAIL_CHANNEL_STATUS.READY_MOCK,
    mutatePartners: false,
    authority: "CJ_API_ONLY",
    liveEnabled: false,
    publishArmed: false,
  };
}

/**
 * Process one mock/live-normalized email event into a non-mutating hint.
 */
export function processAffiliateEmailEvent(event = {}, opts = {}) {
  const diag = diagnoseForpsiEmailChannel();
  if (opts.requireLive === true && diag.status === EMAIL_CHANNEL_STATUS.LIVE_BLOCKED) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: diag.imap.liveGateReason || "live_imap_blocked",
      mutate: false,
      hint: null,
    };
  }
  const hint = emailHintToLifecycleAction(event);
  return {
    ok: true,
    status: opts.mock === true ? "PASS_MOCK" : diag.status,
    mutate: false,
    requiresCjApi: true,
    hint,
    liveEnabled: false,
    publishArmed: false,
  };
}

export function runMockEmailMatrix() {
  const cases = [
    {
      id: "new_approval",
      event: {
        from: "owner-membermessaging@mx6.cj.com",
        subject: "Program approval — Eshop.mojelekarna.cz",
        kind: "approved",
      },
    },
    {
      id: "duplicate",
      event: {
        from: "owner-membermessaging@mx6.cj.com",
        subject: "Program approval",
        duplicate: true,
      },
    },
    {
      id: "spoof",
      event: { from: "attacker@evil.test", subject: "You are ended", kind: "ended" },
    },
    {
      id: "ended_hint",
      event: {
        from: "owner-membermessaging@mx6.cj.com",
        subject: "Cooperation ended",
        kind: "ended",
      },
    },
  ];
  const results = cases.map((c) => ({
    id: c.id,
    ...processAffiliateEmailEvent(c.event, { mock: true }),
  }));
  const allNoMutate = results.every((r) => r.mutate === false);
  return {
    OK: allNoMutate,
    results,
    liveImap: diagnoseForpsiEmailChannel(),
    liveEnabled: false,
    publishArmed: false,
  };
}

if (process.argv[1] && process.argv[1].endsWith("iu-cj-affiliate-phase3m-email-hint-v1.mjs")) {
  console.log(JSON.stringify(runMockEmailMatrix(), null, 2));
}
