/** 24/7 poll scheduler logic (offline — no network loop by default). */
import {
  FORPSI_IMAP_SYNC_DEFAULTS,
} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import { isForpsiImapLiveConnectApproved } from "./iu-forpsi-imap-credentials-interface.mjs";
import { runMailboxSyncBatch } from "./iu-cj-affiliate-phase2-forpsi-imap-sync-lib.mjs";
import { createForpsiImapTransport } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";

export function computePollBackoffMs(attempt, baseMs = FORPSI_IMAP_SYNC_DEFAULTS.retryBaseDelayMs) {
  const capped = Math.min(attempt, FORPSI_IMAP_SYNC_DEFAULTS.retryMaxAttempts);
  return baseMs * Math.pow(2, capped - 1);
}

export function shouldStartPollLoop(config = {}) {
  if (config.enabled !== true) return { ok: false, reason: "poll_not_enabled" };
  if (!isForpsiImapLiveConnectApproved()) return { ok: false, reason: "live_connect_not_approved" };
  if (config.paused === true) return { ok: false, reason: "poll_paused" };
  return { ok: true };
}

/** Single incremental poll tick — safe to call from cron/systemd (Step C after approval). */
export async function runPollTick(options = {}) {
  const gate = shouldStartPollLoop(options.pollConfig || {});
  if (!gate.ok) return { ok: false, phase: "poll_gate", ...gate };

  const transport = await createForpsiImapTransport(options.transportOptions || {});
  return runMailboxSyncBatch({
    ...options,
    transport,
    mode: "incremental",
    batchSize: options.batchSize || 15,
  });
}

export function describe247Architecture() {
  return {
    recommendedDeployment: "Dedicated VPS/systemd timer or Windows Task Scheduler — not Cloudflare Worker (no raw IMAP on Workers per v24 audit architecture)",
    pollIntervalMs: FORPSI_IMAP_SYNC_DEFAULTS.pollIntervalMsDefault,
    minIntervalMs: FORPSI_IMAP_SYNC_DEFAULTS.pollIntervalMsMin,
    concurrency: "forpsi-imap-sync.lock file exclusive owner",
    pauseFlagEnv: "IU_FORPSI_IMAP_POLL_PAUSED=1",
    liveConnectFlagEnv: "IU_FORPSI_IMAP_CONNECT_APPROVED=1",
    activation: "Requires operator approval after Step B verification — not enabled in Step A",
  };
}
