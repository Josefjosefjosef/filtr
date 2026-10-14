#!/usr/bin/env node
/**
 * Fail when production info_events feed is older than SLA (stale CAP snapshot).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_AGE_MS = parseInt(process.env.IU_CHMI_FEED_MAX_AGE_MS || String(6 * 3600 * 1000), 10);
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

async function headJson(url) {
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  return { ok: true, status: res.status, data };
}

const localFeed = path.join(REPO, "projects", "data", "info_events", "feed.json");
if (fs.existsSync(localFeed)) {
  const local = JSON.parse(fs.readFileSync(localFeed, "utf8"));
  const gen = Date.parse(local.generatedAt || local.generatedAtUtc || "");
  must(Number.isFinite(gen), "local:generatedAt_parse");
  if (Number.isFinite(gen)) {
    const age = Date.now() - gen;
    must(age <= MAX_AGE_MS, "local:feed_stale_age_ms_" + age);
  }
}

const prod = await headJson("https://infouzel.cz/projects/data/info_events/feed.json");
must(prod.ok === true, "prod:feed_http");
if (prod.data) {
  const gen = Date.parse(prod.data.generatedAt || prod.data.generatedAtUtc || "");
  must(Number.isFinite(gen), "prod:generatedAt_parse");
  if (Number.isFinite(gen)) {
    const age = Date.now() - gen;
    console.log("IU_CHMI_FEED_AGE_MS=" + age);
    must(age <= MAX_AGE_MS, "prod:feed_stale_age_ms_" + age);
  }
}

if (fails.length) {
  console.log("IU_CHMI_FEED_FRESHNESS_GUARD=FAIL");
  for (const f of fails) console.log(f);
  process.exit(1);
}
console.log("IU_CHMI_FEED_FRESHNESS_GUARD=PASS");
