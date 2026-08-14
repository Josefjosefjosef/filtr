#!/usr/bin/env node
/**
 * Read-only forensic dump for NDIC live-60s stale-R2 incidents.
 * No restarts, no writes — stdout only.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.env.IU_NDIC_LIVE_ROOT
  ? path.resolve(process.env.IU_NDIC_LIVE_ROOT)
  : path.join(process.env.HOME || ".", ".cache", "infouzel-ndic-live");

const work = path.join(root, "work", "info_events");
const snap = path.join(work, "ndic_datex_v1", "traffic_offline_snapshot.json");
const feed = path.join(work, "feed.json");
const diag = path.join(work, "ndic_datex_v1", "diagnostics.json");
const ptr = path.join(root, "current-generation.json");
const lkg = path.join(root, "lkg", "traffic_offline_snapshot.json");
const lock = path.join(root, "live.lock");
const cronLog = path.join(root, "cron.log");

function statLine(p, label) {
  try {
    const st = fs.statSync(p);
    console.log(label + "_EXISTS=YES");
    console.log(label + "_SIZE=" + st.size);
    console.log(label + "_MTIME_UTC=" + st.mtime.toISOString());
  } catch {
    console.log(label + "_EXISTS=NO");
  }
}

function jsonField(p, label, pick) {
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const v = pick(j);
    console.log(
      label + "=" + (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v))
    );
  } catch (e) {
    console.log(label + "_ERROR=" + String(e && e.message ? e.message : e));
  }
}

console.log("FORENSIC_LIVE_ROOT=" + root);
statLine(snap, "WORK_SNAPSHOT");
jsonField(snap, "WORK_SNAPSHOT_GENERATED_AT", (j) => j.generatedAt);
jsonField(snap, "WORK_SNAPSHOT_VERSION", (j) => j.snapshotVersion);
jsonField(snap, "WORK_SNAPSHOT_CARD_COUNT", (j) => j.cardCount);
statLine(feed, "WORK_FEED");
jsonField(feed, "WORK_FEED_GENERATED_AT", (j) => j.generatedAt);
jsonField(feed, "WORK_FEED_ITEM_COUNT", (j) => j.itemCount);
statLine(diag, "WORK_DIAG");
jsonField(diag, "WORK_DIAG_PUBLISH", (j) => j.publish);
jsonField(diag, "WORK_DIAG_TRAFFIC_UI", (j) => j.trafficUiSnapshot);
jsonField(diag, "WORK_DIAG_STATUS", (j) => j.status);
jsonField(diag, "WORK_DIAG_ERROR", (j) => j.error);
statLine(ptr, "GENERATION_POINTER");
jsonField(ptr, "PTR_GENERATION_ID", (j) => j.generationId);
jsonField(ptr, "PTR_SOURCE_LM", (j) => j.sourceLastModified);
jsonField(ptr, "PTR_SEMANTIC_PREFIX", (j) => String(j.semanticChecksum || "").slice(0, 16));
jsonField(ptr, "PTR_CHECKSUM_PREFIX", (j) => String(j.checksum || "").slice(0, 16));
jsonField(ptr, "PTR_SUMMARY_GENERATED_AT", (j) => j.summary && j.summary.generatedAt);
statLine(lkg, "LKG_SNAPSHOT");
jsonField(lkg, "LKG_GENERATED_AT", (j) => j.generatedAt);
jsonField(lkg, "LKG_CARD_COUNT", (j) => j.cardCount);
statLine(lock, "LIVE_LOCK");
try {
  const raw = fs.readFileSync(lock, "utf8");
  console.log("LIVE_LOCK_RAW=" + raw.replace(/\s+/g, " ").trim().slice(0, 200));
} catch {
  console.log("LIVE_LOCK_RAW=");
}
try {
  const out = execSync("ps -eo pid,lstart,cmd --no-headers", { encoding: "utf8" });
  const lines = out.split("\n").filter((l) => /ndic-datex-v1-live-60s-run|cron-tick\.sh/.test(l));
  console.log("LIVE_WRITER_PROCESS_COUNT=" + lines.length);
  lines.slice(0, 5).forEach((l, i) => console.log("LIVE_WRITER_PROCESS_" + (i + 1) + "=" + l.trim()));
} catch (e) {
  console.log("LIVE_WRITER_PROCESS_ERROR=" + String(e && e.message ? e.message : e));
}
try {
  const up = execSync("uptime -p; free -m | head -n2; df -i / | tail -n1", {
    encoding: "utf8",
  });
  console.log("HOST_STATE<<" + up.replace(/\n/g, " | ").trim());
} catch {
  /* ignore */
}
if (fs.existsSync(cronLog)) {
  const text = fs.readFileSync(cronLog, "utf8");
  const lines = text.split("\n").filter(Boolean);
  const writes = lines.filter((l) => /"PRODUCTION_WRITE":"YES"/.test(l));
  const skips = lines.filter((l) => /"SEMANTIC_SKIP":"YES"/.test(l));
  const fails503 = lines.filter((l) =>
    /LIVE_PUBLISH_HTTP_503|"LAST_PUBLICATION_HTTP_STATUS":503/.test(l)
  );
  console.log("CRON_LOG_LINES=" + lines.length);
  console.log("CRON_PRODUCTION_WRITE_YES_COUNT=" + writes.length);
  console.log("CRON_SEMANTIC_SKIP_COUNT=" + skips.length);
  console.log("CRON_503_HINT_COUNT=" + fails503.length);
  if (writes.length) {
    console.log("CRON_LAST_PRODUCTION_WRITE_LINE=" + writes[writes.length - 1].slice(0, 500));
  }
  if (writes.length) {
    const idx = lines.lastIndexOf(writes[writes.length - 1]);
    for (let i = idx + 1; i < lines.length; i++) {
      if (/"SEMANTIC_SKIP":"YES"/.test(lines[i]) || /"PRODUCTION_WRITE":"NO"/.test(lines[i])) {
        console.log("CRON_FIRST_SKIP_AFTER_LAST_WRITE=" + lines[i].slice(0, 500));
        break;
      }
    }
  }
  const early = lines.filter(
    (l) =>
      /"POLL_STARTED_AT":"2026-08-14T08:1[0-9]/.test(l) ||
      /"POLL_STARTED_AT":"2026-08-14T08:2/.test(l)
  );
  early.slice(0, 8).forEach((l, i) => console.log("CRON_08xx_" + (i + 1) + "=" + l.slice(0, 450)));
}
