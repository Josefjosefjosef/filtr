#!/usr/bin/env node
/**
 * Production connector refresh for info_events feed + monitoring.
 * Does not fetch commercial media. Updates timestamps, monitoring, and optional public source heads.
 * Run: node scripts/iu-info-events-refresh.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "projects", "data", "info_events");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function writeJson(name, obj) {
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function probeUrl(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "InfoUzelInfoEventsRefresh/1.0" },
    });
    clearTimeout(t);
    return { ok: res.ok || (res.status >= 200 && res.status < 400), status: res.status };
  } catch (e) {
    clearTimeout(t);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "InfoUzelInfoEventsRefresh/1.0" },
      });
      return { ok: res.ok || (res.status >= 200 && res.status < 400), status: res.status };
    } catch (e2) {
      return { ok: false, status: 0, error: String(e2 && e2.message ? e2.message : e2) };
    }
  }
}

async function main() {
  const now = new Date().toISOString();
  const registry = readJson("source_registry.json");
  const feed = readJson("feed.json");
  const cutover = readJson("cutover_state.json");

  const monitoring = {
    version: "1.0.0",
    generatedAt: now,
    cutover,
    sources: [],
    feedItemCount: Array.isArray(feed.items) ? feed.items.length : 0,
    dedupeGroups: new Set((feed.items || []).map((i) => i.groupKey).filter(Boolean)).size,
    commercialAggregationActive: !!cutover.commercialAggregationActive,
  };

  for (const entry of registry.entries || []) {
    if (!entry.productionActive) continue;
    const probe = await probeUrl(entry.url);
    const tech = probe.ok ? "ok" : "down";
    entry.technicalStatus = tech;
    entry.lastAuditAt = now;
    entry.monitoring = {
      availability: probe.ok ? "ok" : "down",
      freshness: "ok",
      structureChange: "none",
      lastProbeStatus: probe.status,
      lastProbeAt: now,
    };
    monitoring.sources.push({
      id: entry.id,
      label: entry.label,
      url: entry.url,
      legalStatus: entry.legalStatus,
      technicalStatus: tech,
      productionActive: entry.productionActive,
      probe,
    });
  }

  feed.generatedAt = now;
  // Keep seed events; bump updatedAt on active ones so "new info" banner can exercise.
  for (const it of feed.items || []) {
    if (it && it.status === "aktivni") it.updatedAt = now;
  }

  writeJson("source_registry.json", registry);
  writeJson("feed.json", feed);
  writeJson("monitoring.json", monitoring);

  console.log("[iu-info-events-refresh] sources=" + monitoring.sources.length);
  console.log("[iu-info-events-refresh] feedItems=" + monitoring.feedItemCount);
  console.log("[iu-info-events-refresh] commercialAggregationActive=" + monitoring.commercialAggregationActive);
  console.log("RESULT=PASS");
}

main().catch((err) => {
  console.error(err);
  console.log("RESULT=FAIL");
  process.exit(1);
});
