/** In-memory / file-backed mock D1 for offline ingest (not production Cloudflare). */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function hashMessageContent(fields) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        mailbox: fields.mailbox,
        uidvalidity: fields.uidvalidity,
        uid: fields.uid,
        messageId: fields.messageIdHeader || null,
        contentSha256: fields.contentSha256 || null,
      })
    )
    .digest("hex");
}

export function createMockD1Store(storePath = null) {
  let data = {
    version: 1,
    mailbox_messages: {},
    ingest_jobs: {},
    ai_quota: { dayKey: null, callsUsed: 0, maxCallsPerDay: 50 },
    run_leases: {},
  };
  if (storePath && fs.existsSync(storePath)) {
    try {
      data = { ...data, ...JSON.parse(fs.readFileSync(storePath, "utf8")) };
    } catch {
      /* start fresh */
    }
  }

  function persist() {
    if (!storePath) return;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const payload = JSON.stringify(data, null, 2);
    const tmp = storePath + ".tmp";
    try {
      fs.writeFileSync(tmp, payload, "utf8");
      fs.renameSync(tmp, storePath);
    } catch {
      fs.writeFileSync(storePath, payload, "utf8");
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  function messageKey(mailbox, uidvalidity, uid) {
    return String(mailbox) + ":" + String(uidvalidity) + ":" + String(uid);
  }

  return {
    data,
    persist,
    acquireRunLease(runId, ttlMs = 900_000) {
      ttlMs = ttlMs ?? 900_000;
      const now = Date.now();
      for (const [id, lease] of Object.entries(data.run_leases)) {
        if (now - lease.acquiredAt > ttlMs) delete data.run_leases[id];
      }
      const active = Object.values(data.run_leases).find((l) => now - l.acquiredAt < ttlMs);
      if (active && active.runId !== runId) {
        return { ok: false, reason: "concurrent_run_blocked", holder: active.runId };
      }
      data.run_leases[runId] = { runId, acquiredAt: now };
      persist();
      return { ok: true };
    },
    releaseRunLease(runId) {
      delete data.run_leases[runId];
      persist();
      return { ok: true };
    },
    upsertMailboxMessage(record) {
      const key = messageKey(record.mailbox, record.uidvalidity, record.uid);
      const existing = data.mailbox_messages[key];
      if (existing && existing.contentHash === record.contentHash && existing.processingState === "done") {
        return { ok: true, duplicate: true, key };
      }
      data.mailbox_messages[key] = {
        ...existing,
        ...record,
        updatedAt: new Date().toISOString(),
      };
      persist();
      return { ok: true, duplicate: false, key };
    },
    getMessage(key) {
      return data.mailbox_messages[key] || null;
    },
    recordIngestJob(job) {
      const id = job.jobId || createHash("sha256").update(JSON.stringify(job)).digest("hex").slice(0, 16);
      data.ingest_jobs[id] = { ...job, jobId: id, updatedAt: new Date().toISOString() };
      persist();
      return { ok: true, jobId: id };
    },
    incrementAiQuota(dayKey) {
      if (data.ai_quota.dayKey !== dayKey) {
        data.ai_quota = { dayKey, callsUsed: 0, maxCallsPerDay: data.ai_quota.maxCallsPerDay || 50 };
      }
      if (data.ai_quota.callsUsed >= data.ai_quota.maxCallsPerDay) {
        return { ok: false, reason: "ai_quota_exceeded" };
      }
      data.ai_quota.callsUsed += 1;
      persist();
      return { ok: true, callsUsed: data.ai_quota.callsUsed };
    },
    simulateD1Failure(enabled) {
      return enabled ? { ok: false, reason: "d1_write_simulated_failure" } : { ok: true };
    },
  };
}
