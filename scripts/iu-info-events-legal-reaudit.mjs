/**
 * Weekly legal terms reaudit for production-approved sources.
 * Fail-closed: marks SUSPENDED + clears production flags when license/terms URL or hash changes / becomes unavailable.
 * Run: node scripts/iu-info-events-legal-reaudit.mjs
 * Optional: IU_LEGAL_REAUDIT_APPLY=1 to write registry changes.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { isApprovedStatus, loadLegalRegistry, loadSourceRegistry } from "./iu-info-events-legal-registry-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGAL_PATH = path.join(REPO, "projects/data/info_events/legal_source_registry.json");
const SRC_PATH = path.join(REPO, "projects/data/info_events/source_registry.json");
const REPORT_PATH = path.join(REPO, "docs/info-system-v1/15-legal-reaudit-last-report.json");
const APPLY = String(process.env.IU_LEGAL_REAUDIT_APPLY || "") === "1";

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "InfoUzelLegalReaudit/2.0", Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, hash: crypto.createHash("sha256").update(text).digest("hex") };
}

function suspend(entry, reason) {
  entry.status = "SUSPENDED";
  entry.suspended = true;
  entry.productionSourceActive = false;
  entry.suspendReason = reason;
  entry.lastReviewedAt = new Date().toISOString();
  entry.legalNotes = String(entry.legalNotes || "") + " | reaudit-suspend:" + reason;
}

async function main() {
  const legal = loadLegalRegistry(REPO);
  const registry = loadSourceRegistry(REPO);
  const incidents = [];
  const checked = [];

  for (const e of legal.entries || []) {
    if (!isApprovedStatus(e.status) || e.productionSourceActive !== true) continue;
    const urls = [e.licenseUrl, e.termsUrl, e.conditionsEvidenceUrl].filter((u) => /^https:\/\//i.test(String(u || "")));
    const unique = [...new Set(urls)];
    const row = { sourceId: e.sourceId, urls: unique, ok: true, reasons: [] };
    for (const url of unique) {
      try {
        const r = await fetchText(url);
        if (!r.ok) {
          row.ok = false;
          row.reasons.push("http_" + r.status + ":" + url);
          continue;
        }
        const prev = (Array.isArray(e.evidenceHashes) ? e.evidenceHashes : []).find((h) => h && h.url === url);
        if (prev && prev.sha256 && prev.sha256 !== r.hash) {
          row.ok = false;
          row.reasons.push("hash_changed:" + url);
        }
        e.evidenceHashes = (Array.isArray(e.evidenceHashes) ? e.evidenceHashes : []).filter((h) => h.url !== url);
        e.evidenceHashes.push({ url, sha256: r.hash, checkedAt: new Date().toISOString(), bytes: r.text.length });
      } catch (err) {
        row.ok = false;
        row.reasons.push("fetch_error:" + url + ":" + String(err && err.message ? err.message : err));
      }
    }
    const due = Date.parse(String(e.reauditDue || ""));
    if (Number.isFinite(due) && due < Date.now()) {
      row.ok = false;
      row.reasons.push("reaudit_due_passed");
    }
    if (!row.ok) {
      suspend(e, row.reasons.join(";"));
      const src = (registry.entries || []).find((x) => x.id === e.sourceId);
      if (src) {
        src.productionActive = false;
        src.productionApproved = false;
        src.legalStatus = "suspended";
      }
      incidents.push(row);
    }
    checked.push(row);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    checked: checked.length,
    incidents: incidents.length,
    details: checked,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  if (APPLY) {
    fs.writeFileSync(LEGAL_PATH, JSON.stringify(legal, null, 2) + "\n", "utf8");
    fs.writeFileSync(SRC_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
  }
  console.log("[legal-reaudit] checked=" + checked.length + " incidents=" + incidents.length + " apply=" + APPLY);
  console.log("[legal-reaudit] report=" + path.relative(REPO, REPORT_PATH));
  if (incidents.length) {
    console.error("[legal-reaudit] RESULT=FAIL");
    process.exitCode = 1;
  } else {
    console.log("[legal-reaudit] RESULT=PASS");
  }
}

main().catch((e) => {
  console.error("[legal-reaudit] ERROR", e);
  process.exit(1);
});
