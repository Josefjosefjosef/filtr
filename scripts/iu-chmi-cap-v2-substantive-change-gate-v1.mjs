#!/usr/bin/env node
/**
 * CHMI CAP v2 substantive-change gate.
 *
 * Detects no-op / timestamp-only churn that still makes `git diff` non-empty
 * (generatedAt, last_checked_at, runHistory, orchestrator run metadata, …)
 * while bodyHash / alert payload stay identical.
 *
 * Exit 0 always. Prints:
 *   SUBSTANTIVE=true|false
 *   REASON=...
 * Never prints secrets.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO, "projects", "data", "info_events");

const VOLATILE_KEYS = new Set([
  "generatedAt",
  "last_checked_at",
  "last_success_at",
  "lastRunAt",
  "lastSuccessAt",
  "lastSnapshotAt",
  "discoveredAt",
  "fetchedAt",
  "transformedAt",
  "validatedAt",
  "publishedAt",
  "runMs",
  "endToEndLagMs",
  "at",
  "committedAt",
  "runId",
  "runAttempt",
  "startedAt",
  "finishedAt",
  "durationMs",
  "attemptId",
  "githubRunId",
  "githubRunAttempt",
]);

const VOLATILE_OBJECTS = new Set(["runHistory", "lastRun", "attempts", "recentRuns"]);

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (VOLATILE_KEYS.has(k) || VOLATILE_OBJECTS.has(k)) continue;
    out[k] = stripVolatile(v);
  }
  return out;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function headFile(rel) {
  try {
    return execSync(`git show HEAD:${rel}`, { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function listChanged() {
  const out = execSync("git diff --name-only HEAD -- projects/data/info_events", {
    cwd: REPO,
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeContent(rel, raw) {
  if (!raw) return null;
  if (!/\.json$/i.test(rel)) return String(raw).replace(/\r\n/g, "\n").trim();
  try {
    return JSON.stringify(stripVolatile(JSON.parse(raw)));
  } catch {
    return String(raw).replace(/\r\n/g, "\n").trim();
  }
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.log("SUBSTANTIVE=true");
    console.log("REASON=missing_info_events_root");
    return;
  }

  const changed = listChanged();
  if (changed.length === 0) {
    console.log("SUBSTANTIVE=false");
    console.log("REASON=git_clean");
    return;
  }

  const unequal = [];
  for (const rel of changed) {
    const wtPath = path.join(REPO, rel);
    const wtRaw = fs.existsSync(wtPath) ? fs.readFileSync(wtPath, "utf8") : "";
    const headRaw = headFile(rel);
    const a = normalizeContent(rel, headRaw == null ? null : headRaw);
    const b = normalizeContent(rel, wtRaw);
    if (a !== b) unequal.push(rel);
  }

  if (unequal.length === 0) {
    console.log("SUBSTANTIVE=false");
    console.log("REASON=volatile_only");
    console.log("CHANGED_FILES=" + changed.length);
    return;
  }

  console.log("SUBSTANTIVE=true");
  console.log("REASON=payload_or_nonvolatile_diff");
  console.log("UNEQUAL=" + unequal.slice(0, 12).join(","));
}

main();
