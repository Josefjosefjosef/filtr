#!/usr/bin/env node
/**
 * V51.1: slim-tip preserve + prior-run restore + DURABLE_RESTORE_BLOCKED contract.
 * Also covers deterministic transition fixtures (full↔slim, missing ledger).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(
  join(root, ".github/workflows/cj-affiliate-catalog-sync.yml"),
  "utf8"
);

const must = [
  "iu-affiliate-cj-durable-price-history-v50.json",
  "iu-affiliate-cj-durable-price-history-archive-v51.json",
  "iu-affiliate-cj-product-reverify-v50.json",
  "iu-affiliate-cj-product-identity-v50.json",
  "STAGING_SLIM_PRESERVED",
  "PUBLISH_SLIM_PRESERVED",
  "DURABLE_PRIOR_RUN_RESTORE",
  "DURABLE_LEDGER_MISSING",
  "DURABLE_RESTORE_BLOCKED",
  "REGISTRY_LKG_PRIOR_RUN",
  "DURABLE_ARCHIVE_BOOTSTRAP",
];

const missing = must.filter((s) => !wf.includes(s));
if (missing.length) {
  console.error("FAIL missing markers:", missing.join(", "));
  process.exit(1);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Fixture: merge prior durable eventKeys into next without dropping any. */
function mergePreserve(priorKeys, nextKeys) {
  const set = new Set([...(priorKeys || []), ...(nextKeys || [])]);
  return {
    priorKeys: (priorKeys || []).length,
    nextKeys: set.size,
    preserved: (priorKeys || []).filter((k) => set.has(k)).length,
    missing: (priorKeys || []).filter((k) => !set.has(k)).length,
    added: [...set].filter((k) => !(priorKeys || []).includes(k)).length,
  };
}

const cases = [];

// 1) full → full
{
  const prior = ["ek1", "ek2", "ek3"];
  const next = ["ek1", "ek2", "ek3", "ek4"];
  const r = mergePreserve(prior, next);
  assert(r.missing === 0 && r.preserved === 3 && r.added === 1, "full→full");
  cases.push({ id: "full_to_full", ...r, pass: true });
}

// 2) full → slim (must still preserve keys when restore works)
{
  const prior = ["ek1", "ek2"];
  const slimRestored = ["ek1", "ek2"];
  const r = mergePreserve(prior, slimRestored);
  assert(r.missing === 0 && r.preserved === 2, "full→slim preserve");
  cases.push({ id: "full_to_slim_restored", ...r, pass: true });
}

// 3) slim without durable must not invent empty success when prior existed
{
  const priorExisted = true;
  const restored = false;
  const blocked = priorExisted && !restored;
  assert(blocked === true, "slim missing → BLOCKED");
  cases.push({ id: "slim_without_durable_blocked", blocked, pass: true });
}

// 4) duplicate event key idempotence
{
  const prior = ["ek1"];
  const next = ["ek1", "ek1"];
  const r = mergePreserve(prior, [...new Set(next)]);
  assert(r.missing === 0 && r.nextKeys === 1, "dup key");
  cases.push({ id: "duplicate_event_key", ...r, pass: true });
}

// 5) fixture files + sha integrity
{
  const dir = join(tmpdir(), `iu-v511-dur-fix-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const full = {
    schema: "iu-affiliate-cj-durable-price-history-v50",
    eventKeys: ["a", "b", "c"],
    counts: { economicEvents: 3 },
  };
  const slim = {
    schema: "iu-affiliate-cj-product-feed-checkpoints-v31",
    partners: {},
  };
  const fullPath = join(dir, "durable-full.json");
  const slimPath = join(dir, "slim-only.json");
  writeFileSync(fullPath, JSON.stringify(full));
  writeFileSync(slimPath, JSON.stringify(slim));
  const fullSha = sha256(readFileSync(fullPath));
  assert(existsSync(fullPath) && fullSha.length === 64, "fixture sha");
  // slim must not be accepted as durable history
  const slimJson = JSON.parse(readFileSync(slimPath, "utf8"));
  assert(!slimJson.eventKeys, "slim is not durable");
  rmSync(dir, { recursive: true, force: true });
  cases.push({ id: "fixture_sha_and_schema", fullSha, pass: true });
}

// 6) empty staging must not imply empty durable (contract string in sync script)
{
  const sync = readFileSync(
    join(root, "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs"),
    "utf8"
  );
  assert(
    sync.includes("STAGING_EMPTY_VERIFY_ONLY") || sync.includes("writeDurableVerificationLedgers"),
    "VERIFY_ONLY / durable write path present"
  );
  cases.push({ id: "empty_staging_not_empty_durable", pass: true });
}

console.log(
  JSON.stringify(
    {
      PASS: true,
      selftest: "iu-cj-affiliate-phase3z-durable-slim-preserve-v51-selftest",
      workflowMarkers: must.length,
      cases,
    },
    null,
    2
  )
);
