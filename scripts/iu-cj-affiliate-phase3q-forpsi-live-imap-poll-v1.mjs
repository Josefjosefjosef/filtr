#!/usr/bin/env node
/**
 * Phase 3Q — real Forpsi IMAP live poll (read-only EXAMINE + BODY.PEEK).
 *
 * - Requires IU_FORPSI_IMAP_CONNECT_APPROVED=1 + USER/SECRET
 * - Never prints secrets / passwords / full message bodies
 * - Never mutates mailbox (no STORE/MOVE/DELETE/APPEND)
 * - Never mutates affiliate catalog — emits EMAIL_HINT_REQUIRES_CJ_RECONCILE only
 * - Persistent checkpoint via IU_FORPSI_IMAP_CHECKPOINT_DIR (GHA cache/artifact)
 *
 * Exit codes:
 *   0 = CONNECT+AUTH+poll completed (including zero new messages)
 *   1 = gate blocked / connect failed / auth failed / poll hard failure
 *   2 = mock/selftest path only (not used by default)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFILIATE_MAILBOX_ADDRESS,
  DEFAULT_FORPSI_IMAP_TLS_MODE,
  FORPSI_IMAP_HOST,
  FORPSI_IMAP_SYNC_DEFAULTS,
  FORPSI_IMAP_TLS_MODES,
} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import {
  assertForpsiImapLiveConnectAllowed,
  readForpsiImapCredentialSourceMeta,
} from "./iu-forpsi-imap-credentials-interface.mjs";
import {
  createForpsiImapTransport,
  createMockForpsiImapTransport,
} from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import {
  defaultForpsiSyncLockPath,
  defaultForpsiSyncStatePath,
  runMailboxSyncBatch,
} from "./iu-cj-affiliate-phase2-forpsi-imap-sync-lib.mjs";
import { emailHintToLifecycleAction } from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";

export const PHASE3Q_SCHEMA = "iu-cj-affiliate-phase3q-forpsi-live-imap-poll-v1";

function redact(value) {
  const s = String(value || "");
  const user = String(process.env.IU_FORPSI_IMAP_USER || "").trim();
  const secret = String(process.env.IU_FORPSI_IMAP_SECRET || "").trim();
  let out = s;
  if (secret) out = out.split(secret).join("[REDACTED_SECRET]");
  if (user) out = out.split(user).join("[REDACTED_USER]");
  return out.replace(/pass(?:word)?[=:\s]+\S+/gi, "pass=[REDACTED]");
}

function resolveCheckpointDir() {
  const fromEnv = String(process.env.IU_FORPSI_IMAP_CHECKPOINT_DIR || "").trim();
  if (fromEnv) return fromEnv;
  const base = process.env.GITHUB_WORKSPACE
    ? path.join(process.env.GITHUB_WORKSPACE, ".iu-forpsi-imap-checkpoint")
    : path.join(process.env.TEMP || "/tmp", "iu-forpsi-imap-checkpoint");
  return base;
}

function mapCategoryToHintKind(categories = []) {
  const set = new Set(categories || []);
  if (set.has("program_rejection_or_end") || set.has("promotion_change_or_end")) return "ended";
  if (set.has("program_approval") || set.has("partner_welcome")) return "approved";
  if (set.has("coupon") || set.has("limited_time_discount")) return "coupon";
  if (set.has("terms_change") || set.has("program_terms")) return "terms_change";
  if (set.has("product_promotion") || set.has("product_catalog_or_feed")) return "product_promo";
  return "affiliate_notice";
}

export function buildHintsFromBatchResults(batchResults = []) {
  const hints = [];
  for (const row of batchResults) {
    if (!row?.ok) continue;
    const cats = row.categories || [];
    if (!cats.length) continue;
    const kind = mapCategoryToHintKind(cats);
    const event = {
      from: "imap-poll",
      subject: "uid:" + row.uid + " cats:" + cats.join(","),
      kind,
      uid: row.uid,
      categories: cats,
    };
    const hint = emailHintToLifecycleAction(event);
    hints.push({
      uid: row.uid,
      categories: cats,
      lifecycleAction: hint.action || hint.lifecycleAction || "EMAIL_HINT_REQUIRES_CJ_RECONCILE",
      mutate: false,
      requiresCjApi: true,
    });
  }
  return hints;
}

export async function runForpsiLiveImapPoll(options = {}) {
  const startedAt = new Date().toISOString();
  const tls = FORPSI_IMAP_TLS_MODES[DEFAULT_FORPSI_IMAP_TLS_MODE];
  const checkpointDir = options.checkpointDir || resolveCheckpointDir();
  fs.mkdirSync(checkpointDir, { recursive: true });
  const statePath = options.statePath || defaultForpsiSyncStatePath(checkpointDir);
  const lockPath = options.lockPath || defaultForpsiSyncLockPath(checkpointDir);
  const meta = readForpsiImapCredentialSourceMeta();
  const gate = assertForpsiImapLiveConnectAllowed();

  const base = {
    schema: PHASE3Q_SCHEMA,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    mutatePartners: false,
    authority: "CJ_API_ONLY",
    mailbox: AFFILIATE_MAILBOX_ADDRESS,
    imap: {
      host: FORPSI_IMAP_HOST,
      port: tls.port,
      tls: true,
      rejectUnauthorized: tls.rejectUnauthorized === true,
      mode: tls.id,
    },
    credentialsConfigured: { hasUser: meta.hasUser, hasSecret: meta.hasSecret, source: meta.source },
    checkpointDir,
    statePath,
    startedAt,
  };

  if (options.forceMock === true) {
    const transport = createMockForpsiImapTransport(options.mockFixture || { messages: [] });
    const sync = await runMailboxSyncBatch({
      transport,
      statePath,
      lockPath,
      ownerId: options.ownerId || "mock-poll",
      mailbox: AFFILIATE_MAILBOX_ADDRESS,
      folder: "INBOX",
      batchSize: options.batchSize || FORPSI_IMAP_SYNC_DEFAULTS.batchSize,
      mode: "incremental",
      catalogAdvertisers: options.catalogAdvertisers || [],
    });
    const hints = buildHintsFromBatchResults(sync.batchResults || []);
    return {
      ...base,
      ok: sync.ok === true,
      mode: "mock",
      imapConnected: sync.ok === true,
      authSuccess: sync.ok === true,
      messagesChecked: sync.stats?.found ?? 0,
      messagesInBatch: sync.batchSize ?? 0,
      relevantHints: hints.length,
      hints,
      checkpoint: {
        path: statePath,
        complete: sync.complete === true,
        pendingAfterBatch: sync.pendingAfterBatch ?? null,
        uidvalidity: sync.uidvalidity ?? null,
      },
      cjApiFollowUp: "EMAIL_HINT_REQUIRES_CJ_RECONCILE_ONLY",
      exitCode: sync.ok ? 0 : 1,
    };
  }

  if (!gate.ok) {
    return {
      ...base,
      ok: false,
      mode: "live",
      imapConnected: false,
      authSuccess: false,
      status: "BLOCKED",
      reason: gate.reason || "live_connect_not_approved",
      messagesChecked: 0,
      messagesInBatch: 0,
      relevantHints: 0,
      hints: [],
      exitCode: 1,
    };
  }
  if (!meta.hasUser || !meta.hasSecret) {
    return {
      ...base,
      ok: false,
      mode: "live",
      imapConnected: false,
      authSuccess: false,
      status: "BLOCKED",
      reason: "credentials_missing",
      messagesChecked: 0,
      messagesInBatch: 0,
      relevantHints: 0,
      hints: [],
      exitCode: 1,
    };
  }

  let sync;
  try {
    const transport = await createForpsiImapTransport({
      host: FORPSI_IMAP_HOST,
      tlsModeId: DEFAULT_FORPSI_IMAP_TLS_MODE,
    });
    // Probe connect/auth first so failures are classified (no false PASS).
    let connectResult;
    try {
      connectResult = await transport.connect();
    } catch (err) {
      const msg = redact(err?.message || err);
      const authFail = /credentials|login|auth|AUTHENTICATIONFAILED|\bNO\b/i.test(msg);
      try {
        await transport.disconnect();
      } catch {
        /* ignore */
      }
      return {
        ...base,
        ok: false,
        mode: "live",
        imapConnected: !authFail,
        authSuccess: false,
        status: authFail ? "AUTH_FAILED" : "CONNECT_FAILED",
        reason: msg.slice(0, 200),
        messagesChecked: 0,
        relevantHints: 0,
        hints: [],
        exitCode: 1,
      };
    }
    if (!connectResult?.ok) {
      try {
        await transport.disconnect();
      } catch {
        /* ignore */
      }
      return {
        ...base,
        ok: false,
        mode: "live",
        imapConnected: false,
        authSuccess: false,
        status: "CONNECT_FAILED",
        reason: redact(connectResult?.reason || "connect_not_ok"),
        messagesChecked: 0,
        relevantHints: 0,
        hints: [],
        exitCode: 1,
      };
    }
    try {
      await transport.disconnect();
    } catch {
      /* ignore */
    }

    const transport2 = await createForpsiImapTransport({
      host: FORPSI_IMAP_HOST,
      tlsModeId: DEFAULT_FORPSI_IMAP_TLS_MODE,
    });
    sync = await runMailboxSyncBatch({
      transport: transport2,
      statePath,
      lockPath,
      ownerId: options.ownerId || "gha-live-poll-" + (process.env.GITHUB_RUN_ID || process.pid),
      mailbox: AFFILIATE_MAILBOX_ADDRESS,
      folder: "INBOX",
      batchSize: options.batchSize || FORPSI_IMAP_SYNC_DEFAULTS.batchSize,
      mode: "incremental",
      catalogAdvertisers: options.catalogAdvertisers || [],
      maxMessageBytes: FORPSI_IMAP_SYNC_DEFAULTS.maxMessageBytes,
    });
  } catch (err) {
    const msg = redact(err?.message || err);
    const authFail = /credentials|login|auth|AUTHENTICATIONFAILED/i.test(msg);
    const connectFail = /ECONN|ENOTFOUND|ETIMEDOUT|certificate|TLS|imap_read_timeout/i.test(msg);
    return {
      ...base,
      ok: false,
      mode: "live",
      imapConnected: !connectFail && !authFail,
      authSuccess: !authFail && !connectFail,
      status: authFail ? "AUTH_FAILED" : connectFail ? "CONNECT_FAILED" : "POLL_FAILED",
      reason: msg.slice(0, 200),
      messagesChecked: 0,
      relevantHints: 0,
      hints: [],
      exitCode: 1,
    };
  }

  if (!sync?.ok) {
    return {
      ...base,
      ok: false,
      mode: "live",
      imapConnected: true,
      authSuccess: true,
      status: "POLL_FAILED",
      reason: redact(sync?.reason || sync?.phase || "sync_failed"),
      phase: sync?.phase || null,
      messagesChecked: sync?.stats?.found ?? 0,
      messagesInBatch: sync?.batchSize ?? 0,
      relevantHints: 0,
      hints: [],
      checkpoint: { path: statePath, uidvalidity: sync?.uidvalidity ?? null },
      exitCode: 1,
    };
  }

  const hints = buildHintsFromBatchResults(sync.batchResults || []);
  return {
    ...base,
    ok: true,
    mode: "live",
    status: "LIVE_POLL_OK",
    imapConnected: true,
    authSuccess: true,
    messagesChecked: sync.stats?.found ?? 0,
    messagesInBatch: sync.batchSize ?? 0,
    messagesProcessed: sync.stats?.processed ?? 0,
    duplicates: sync.stats?.duplicates ?? 0,
    quarantined: sync.stats?.quarantined ?? 0,
    errors: sync.stats?.errors ?? 0,
    relevantHints: hints.length,
    hints: hints.slice(0, 50),
    checkpoint: {
      path: statePath,
      complete: sync.complete === true,
      pendingAfterBatch: sync.pendingAfterBatch ?? 0,
      uidvalidity: sync.uidvalidity ?? null,
      lastBatchAt: null,
    },
    cjApiFollowUp: "EMAIL_HINT_REQUIRES_CJ_RECONCILE_ONLY",
    note: "Email never mutates partners/buttons/coupons/products; reconcile via CJ API only",
    finishedAt: new Date().toISOString(),
    exitCode: 0,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const forceMock = process.env.IU_FORPSI_IMAP_FORCE_MOCK === "1";
  runForpsiLiveImapPoll({ forceMock })
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      process.exit(typeof out.exitCode === "number" ? out.exitCode : out.ok ? 0 : 1);
    })
    .catch((err) => {
      console.log(
        JSON.stringify(
          {
            schema: PHASE3Q_SCHEMA,
            ok: false,
            imapConnected: false,
            authSuccess: false,
            status: "POLL_FAILED",
            reason: redact(err?.message || err),
            mutatePartners: false,
            liveEnabled: false,
            publishArmed: false,
          },
          null,
          2
        )
      );
      process.exit(1);
    });
}
