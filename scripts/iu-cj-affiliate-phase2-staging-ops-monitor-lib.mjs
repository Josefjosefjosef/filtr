/** Operational snapshot from unattended audit JSONL (no secrets / no mail bodies). */
import fs from "node:fs";

const REDACT_KEYS = new Set([
  "pat",
  "password",
  "secret",
  "token",
  "authorization",
  "imap",
  "mime",
  "body",
  "rawEmail",
]);

export function sanitizeAuditEvent(event) {
  if (!event || typeof event !== "object") return { event: "invalid" };
  const out = {};
  for (const [k, v] of Object.entries(event)) {
    const lower = k.toLowerCase();
    if (REDACT_KEYS.has(lower) || lower.includes("secret") || lower.includes("password")) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function parseAuditJsonl(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ event: "parse_error", line: line.slice(0, 120) });
    }
  }
  return events;
}

export function buildStagingOpsSnapshot(events = []) {
  let lastSuccessAt = null;
  let lastErrorAt = null;
  let lastError = null;
  let receivedTotal = 0;
  let rejectedTotal = 0;
  let duplicateTotal = 0;
  let http429 = 0;
  let authErrors = 0;
  let imapErrors = 0;
  let zeroImport = 0;
  let lockContention = 0;

  for (const ev of events) {
    const name = String(ev.event || "");
    if (name === "run_complete" && ev.publishable !== true) {
      lastSuccessAt = ev.ts || ev.at || lastSuccessAt;
    }
    if (name.includes("fail") || ev.ok === false || name === "live_gate_blocked") {
      lastErrorAt = ev.ts || ev.at || lastErrorAt;
      lastError = name;
      if (name.includes("429") || ev.status === 429) http429 += 1;
      if (name.includes("auth") || ev.status === 401 || ev.status === 403) authErrors += 1;
      if (name.includes("imap")) imapErrors += 1;
    }
    if (name === "product_feed_probe" && ev.emptyFeed === true) zeroImport += 1;
    if (name === "lock" && ev.reason === "lock_held") lockContention += 1;
    if (typeof ev.receivedCount === "number") receivedTotal += ev.receivedCount;
    if (typeof ev.rejectedCount === "number") rejectedTotal += ev.rejectedCount;
    if (typeof ev.duplicateCount === "number") duplicateTotal += ev.duplicateCount;
  }

  return {
    lastSuccessAt,
    lastErrorAt,
    lastError,
    receivedTotal,
    rejectedTotal,
    duplicateTotal,
    http429,
    authErrors,
    imapErrors,
    zeroImport,
    lockContention,
    staleData: lastSuccessAt && lastErrorAt && lastErrorAt > lastSuccessAt,
    publishable: false,
  };
}

export function buildStagingOpsSnapshotFromFile(auditPath) {
  const text = fs.readFileSync(auditPath, "utf8");
  return buildStagingOpsSnapshot(parseAuditJsonl(text));
}
