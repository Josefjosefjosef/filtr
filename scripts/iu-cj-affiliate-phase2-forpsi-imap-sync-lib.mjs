/** FORPSI mailbox sync orchestrator — batching, checkpoints, concurrency (file state). */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  AFFILIATE_MAILBOX_ADDRESS,
  FORPSI_IMAP_DEFAULT_FOLDERS,
  FORPSI_IMAP_SYNC_DEFAULTS,
} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import { createForpsiImapTransport } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import { processPartnerMessageForForpsiStaging } from "./iu-cj-affiliate-phase2-forpsi-imap-ingest-lib.mjs";
import { PROCESSING_STATE } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

export function defaultForpsiSyncStatePath(stateDir) {
  return path.join(stateDir, "forpsi-imap-sync-state.json");
}

export function defaultForpsiSyncLockPath(stateDir) {
  return path.join(stateDir, "forpsi-imap-sync.lock");
}

export function loadSyncState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function saveSyncState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function acquireSyncLock(lockPath, ownerId, maxAgeMs = 3600_000) {
  const now = Date.now();
  if (fs.existsSync(lockPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (existing.ownerId !== ownerId && now - existing.acquiredAt < maxAgeMs) {
        return { ok: false, reason: "sync_lock_held", holder: existing.ownerId };
      }
    } catch {
      return { ok: false, reason: "sync_lock_corrupt" };
    }
  }
  const payload = { ownerId, acquiredAt: now };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(payload), "utf8");
  return { ok: true };
}

export function releaseSyncLock(lockPath, ownerId) {
  if (!fs.existsSync(lockPath)) return { ok: true };
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (existing.ownerId !== ownerId) return { ok: false, reason: "not_lock_owner" };
    fs.unlinkSync(lockPath);
    return { ok: true };
  } catch {
    return { ok: false, reason: "lock_release_failed" };
  }
}

export function detectUidValidityChange(previous, current) {
  if (!previous || previous.uidvalidity == null) return { changed: false };
  if (current.uidvalidity == null) return { changed: false, unknown: true };
  if (Number(previous.uidvalidity) !== Number(current.uidvalidity)) {
    return { changed: true, previous: previous.uidvalidity, current: current.uidvalidity };
  }
  return { changed: false };
}

export async function inventoryMailboxes(transport, folders = FORPSI_IMAP_DEFAULT_FOLDERS) {
  await transport.connect();
  const listed = await transport.listMailboxes();
  const inventory = [];
  for (const folder of folders) {
    const sel = await transport.selectMailbox(folder);
    if (!sel.ok && sel.reason) {
      inventory.push({ folder, ok: false, reason: sel.reason });
      continue;
    }
    const uids = await transport.fetchAllUids();
    inventory.push({
      folder,
      ok: true,
      messageCount: uids.length,
      uidvalidity: sel.uidvalidity ?? null,
      uidMin: uids.length ? uids[0] : null,
      uidMax: uids.length ? uids[uids.length - 1] : null,
    });
  }
  return inventory;
}

export async function runMailboxSyncBatch(options = {}) {
  const {
    transport,
    statePath,
    lockPath,
    ownerId = "sync-" + process.pid,
    mailbox = AFFILIATE_MAILBOX_ADDRESS,
    folder = "INBOX",
    batchSize = FORPSI_IMAP_SYNC_DEFAULTS.batchSize,
    mode = "initial_full",
    catalogAdvertisers = [],
    maxMessageBytes = FORPSI_IMAP_SYNC_DEFAULTS.maxMessageBytes,
  } = options;

  const lock = acquireSyncLock(lockPath, ownerId);
  if (!lock.ok) return { ok: false, phase: "lock", ...lock };

  let state = loadSyncState(statePath) || {
    version: 1,
    mailbox,
    folder,
    uidvalidity: null,
    processedUids: [],
    failedUids: {},
    stats: {
      found: 0,
      processed: 0,
      duplicates: 0,
      quarantined: 0,
      errors: 0,
    },
    categories: {},
    lastSuccessAt: null,
    mode,
  };

  try {
    await transport.connect();
    const sel = await transport.selectMailbox(folder);
    if (!sel.ok) {
      return { ok: false, phase: "select", reason: sel.reason || "select_failed" };
    }
    const uidvalidity = sel.uidvalidity ?? state.uidvalidity;
    const uvChange = detectUidValidityChange(state, { uidvalidity });
    if (uvChange.changed) {
      state = {
        ...state,
        uidvalidity,
        processedUids: [],
        failedUids: {},
        uidvalidityResetAt: new Date().toISOString(),
        uidvalidityPrevious: uvChange.previous,
      };
    } else if (uidvalidity != null) {
      state.uidvalidity = uidvalidity;
    }

    const allUids = await transport.fetchAllUids();
    state.stats.found = allUids.length;
    const processedSet = new Set(state.processedUids.map(Number));
    const pending = allUids.filter((uid) => !processedSet.has(Number(uid)));
    const batch = pending.slice(0, Math.min(batchSize, FORPSI_IMAP_SYNC_DEFAULTS.maxBatchSize));

    const batchResults = [];
    const existingKeys = state.mailboxKeys || [];
    const existingActions = state.commercialActionRecords || [];

    for (const uid of batch) {
      try {
        const fetched = await transport.fetchMessageByUid(uid);
        if (!fetched.ok) {
          state.failedUids[String(uid)] = fetched.reason || "fetch_failed";
          state.stats.errors += 1;
          batchResults.push({ uid, ok: false, reason: fetched.reason });
          continue;
        }
        const msg = fetched.message;
        if (msg.sizeBytes > maxMessageBytes) {
          state.failedUids[String(uid)] = "message_too_large";
          state.stats.quarantined += 1;
          batchResults.push({ uid, ok: false, reason: "message_too_large" });
          continue;
        }
        const result = processPartnerMessageForForpsiStaging(msg, {
          catalogAdvertisers,
          existingKeys,
          existingCommercialActionRecords: existingActions,
          uidvalidity: state.uidvalidity ?? msg.uidvalidity,
        });
        if (result.state === PROCESSING_STATE.duplicate_skipped) state.stats.duplicates += 1;
        else if (result.state === PROCESSING_STATE.quarantined) state.stats.quarantined += 1;
        else state.stats.processed += 1;

        for (const cat of result.affiliateCategories || []) {
          state.categories[cat] = (state.categories[cat] || 0) + 1;
        }
        if (result.mailboxKey?.ok) existingKeys.push(result.mailboxKey);
        if (result.commercialDrafts?.length) {
          for (const d of result.commercialDrafts) {
            existingActions.push({
              commercialActionKey: d.commercialActionKey,
              mailboxKeyId: result.mailboxKey?.keyId,
              actionIndex: d.commercialActionIndex,
              blockFingerprint: d.rawBlockFingerprint,
            });
          }
        }
        state.processedUids.push(uid);
        // Safe AI excerpt only — never persist full bodies into checkpoint/artifacts.
        const subjectSafe = String(msg.subject || "").slice(0, 240);
        const fromSafe = String(msg.from || "").slice(0, 200);
        const rawExcerpt = String(msg.bodyText || msg.bodyHtmlStripped || "")
          .replace(/\0/g, "")
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
          .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[REDACTED_PHONE]")
          .slice(0, FORPSI_IMAP_SYNC_DEFAULTS.aiExcerptChars || 2_000);
        batchResults.push({
          uid,
          ok: true,
          state: result.state,
          categories: result.affiliateCategories,
          subjectSafe,
          fromSafe,
          excerptSafe: rawExcerpt,
        });
      } catch (err) {
        state.failedUids[String(uid)] = String(err.message || err).slice(0, 200);
        state.stats.errors += 1;
        batchResults.push({ uid, ok: false, reason: "processing_exception" });
      }
    }

    state.mailboxKeys = existingKeys;
    state.commercialActionRecords = existingActions;
    state.lastBatchAt = new Date().toISOString();
    state.lastBatchSize = batch.length;
    const processedAfter = new Set(state.processedUids.map(Number));
    const retryablePending = allUids.filter((uid) => !processedAfter.has(Number(uid)));
    state.pendingCount = retryablePending.length;
    state.complete = retryablePending.length === 0;
    state.batchHadErrors = batchResults.some((r) => r.ok === false);
    if (state.complete && !state.batchHadErrors && Object.keys(state.failedUids || {}).length === 0) {
      state.lastSuccessAt = new Date().toISOString();
    }
    if (batch.length > 0 && !state.batchHadErrors) {
      state.lastBatchSuccessAt = new Date().toISOString();
    }

    saveSyncState(statePath, state);
    return {
      ok: true,
      phase: state.complete ? "initial_complete" : "batch_progress",
      batchSize: batch.length,
      pendingAfterBatch: state.pendingCount,
      complete: state.complete === true,
      batchHadErrors: state.batchHadErrors === true,
      uidvalidity: state.uidvalidity,
      uidvalidityChanged: uvChange.changed === true,
      stats: state.stats,
      batchResults,
      productionSigning: "BLOCKED",
      autoPublication: false,
    };
  } finally {
    releaseSyncLock(lockPath, ownerId);
    try {
      await transport.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Fetch-only batch for GHA ingest — does NOT mark UIDs processed or run staging.
 * Checkpoint completion is owned by D1 store after full pipeline.
 */
export async function runMailboxFetchBatch(options = {}) {
  const {
    transport,
    ownerId = "fetch-" + process.pid,
    mailbox = AFFILIATE_MAILBOX_ADDRESS,
    folder = "INBOX",
    batchSize = FORPSI_IMAP_SYNC_DEFAULTS.batchSize,
    maxMessageBytes = FORPSI_IMAP_SYNC_DEFAULTS.maxMessageBytes,
    isUidCompleted = () => false,
    onUidValidity = () => {},
  } = options;

  await transport.connect();
  const sel = await transport.selectMailbox(folder);
  if (!sel.ok) {
    return { ok: false, phase: "select", reason: sel.reason || "select_failed" };
  }
  const uidvalidity = sel.uidvalidity ?? null;
  onUidValidity(uidvalidity);

  const allUids = await transport.fetchAllUids();
  const pending = allUids.filter((uid) => !isUidCompleted(uid));
  const batch = pending.slice(0, Math.min(batchSize, FORPSI_IMAP_SYNC_DEFAULTS.maxBatchSize));
  const batchResults = [];

  for (const uid of batch) {
    try {
      const fetched = await transport.fetchMessageByUid(uid);
      if (!fetched.ok) {
        batchResults.push({ uid, ok: false, reason: fetched.reason });
        continue;
      }
      const msg = fetched.message;
      if (msg.sizeBytes > maxMessageBytes) {
        batchResults.push({ uid, ok: false, reason: "message_too_large" });
        continue;
      }
      batchResults.push({ uid, ok: true, message: msg, fromImapFetch: true });
    } catch {
      batchResults.push({ uid, ok: false, reason: "fetch_exception" });
    }
  }

  try {
    await transport.disconnect();
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    phase: "fetch_batch",
    batchSize: batch.length,
    pendingBeforeBatch: pending.length,
    uidvalidity,
    batchResults,
    productionSigning: "BLOCKED",
    autoPublication: false,
  };
}

export async function runInitialSyncSimulation(fixtureMessages, options = {}) {
  const transport = await createForpsiImapTransport({ mode: "mock", mockFixture: { messages: fixtureMessages } });
  const stateDir = options.stateDir || path.join(process.env.TEMP || "/tmp", "iu-forpsi-imap-sync-" + process.pid);
  return runMailboxSyncBatch({
    transport,
    statePath: path.join(stateDir, "state.json"),
    lockPath: path.join(stateDir, "sync.lock"),
    ownerId: options.ownerId || "sim",
    batchSize: options.batchSize || FORPSI_IMAP_SYNC_DEFAULTS.batchSize,
    catalogAdvertisers: options.catalogAdvertisers || [],
  });
}

export function buildAdminSyncOverview(state) {
  if (!state) return { ok: false, reason: "no_state" };
  const s = state.stats || {};
  return {
    ok: true,
    mailbox: state.mailbox,
    folder: state.folder,
    messagesFound: s.found ?? 0,
    messagesProcessed: s.processed ?? 0,
    duplicates: s.duplicates ?? 0,
    quarantined: s.quarantined ?? 0,
    errors: s.errors ?? 0,
    welcomeCount: state.categories?.partner_welcome ?? 0,
    contractCount: (state.categories?.program_terms ?? 0) + (state.categories?.terms_change ?? 0),
    couponCount: state.categories?.coupon ?? 0,
    productPromoCount: state.categories?.product_promotion ?? 0,
    requiresReviewCount: state.categories?.requires_review ?? 0,
    lastSuccessAt: state.lastSuccessAt,
    pendingCount: state.pendingCount ?? null,
    uidvalidity: state.uidvalidity,
    productionTrust: "BLOCKED – AWAITING TRUSTED ADAPTER",
    publicAdminSurface: false,
  };
}

export function hashSyncStateForAudit(state) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}
