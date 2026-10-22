#!/usr/bin/env node
/**
 * Resolve staging CJ D1 uuid by exact name; patch only [[env.staging.d1_databases]] in wrangler.toml.
 * Fail-closed: no create, no guess, exactly one match required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
export const STAGING_D1_NAME = "iu-cj-email-ingest-staging";
const STAGING_D1_MARKER = "[[env.staging.d1_databases]]";

export function resolveStagingD1IdFromList(rows, expectedName = STAGING_D1_NAME) {
  const list = Array.isArray(rows) ? rows : [];
  const hits = list.filter((r) => r && String(r.name) === expectedName);
  if (hits.length === 0) {
    return { ok: false, reason: "d1_not_found", count: 0, expectedName };
  }
  if (hits.length > 1) {
    return { ok: false, reason: "d1_ambiguous", count: hits.length, expectedName };
  }
  const id = String(hits[0].uuid || hits[0].id || "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id) || id === PLACEHOLDER_D1_ID) {
    return { ok: false, reason: "d1_invalid_uuid", count: 1, expectedName };
  }
  return { ok: true, reason: "ok", count: 1, expectedName, id: id.toLowerCase() };
}

export function patchWranglerStagingD1DatabaseId(wranglerText, id) {
  if (!wranglerText.includes(STAGING_D1_MARKER)) {
    return { ok: false, reason: "staging_d1_block_missing" };
  }
  if (!STAGING_D1_NAME) {
    return { ok: false, reason: "internal" };
  }
  const parts = wranglerText.split(STAGING_D1_MARKER);
  if (parts.length < 2) {
    return { ok: false, reason: "staging_d1_block_missing" };
  }
  const head = parts[0];
  let tail = parts.slice(1).join(STAGING_D1_MARKER);
  if (!tail.includes(`database_name = "${STAGING_D1_NAME}"`)) {
    return { ok: false, reason: "staging_d1_name_missing" };
  }
  const patched = tail.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
  if (patched === tail) {
    return { ok: false, reason: "database_id_line_missing" };
  }
  return { ok: true, reason: "ok", text: head + STAGING_D1_MARKER + patched };
}

function parseArgs(argv) {
  const opts = {
    expectName: STAGING_D1_NAME,
    patchPath: null,
    listJson: null,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--expect-name") {
      opts.expectName = argv[++i];
    } else if (a === "--patch") {
      opts.patchPath = argv[++i];
    } else if (a === "--list-json") {
      opts.listJson = argv[++i];
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--help") {
      opts.help = true;
    }
  }
  return opts;
}

async function readAllStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log("Usage: iu-cj-affiliate-staging-d1-resolve-v1.mjs [--list-json FILE] [--patch wrangler.toml] [--expect-name NAME] [--dry-run]");
    process.exit(0);
  }
  let raw = opts.listJson ? fs.readFileSync(opts.listJson, "utf8") : await readAllStdin();
  raw = raw.trim();
  if (!raw) {
    console.error(JSON.stringify({ IU_CJ_STAGING_D1_RESOLVE: "FAIL", reason: "empty_list_json" }));
    process.exit(1);
  }
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    console.error(JSON.stringify({ IU_CJ_STAGING_D1_RESOLVE: "FAIL", reason: "invalid_list_json" }));
    process.exit(1);
  }
  const resolved = resolveStagingD1IdFromList(rows, opts.expectName);
  if (!resolved.ok) {
    console.error(JSON.stringify({ IU_CJ_STAGING_D1_RESOLVE: "FAIL", ...resolved }));
    process.exit(1);
  }
  console.error(
    JSON.stringify({
      IU_CJ_STAGING_D1_RESOLVE: "OK",
      D1_DATABASE_NAME_MATCH: "PASS",
      count: resolved.count,
      idLength: resolved.id.length,
    })
  );
  if (opts.patchPath) {
    const toml = fs.readFileSync(opts.patchPath, "utf8");
    const patched = patchWranglerStagingD1DatabaseId(toml, resolved.id);
    if (!patched.ok) {
      console.error(JSON.stringify({ IU_CJ_STAGING_D1_PATCH: "FAIL", reason: patched.reason }));
      process.exit(1);
    }
    if (!opts.dryRun) {
      fs.writeFileSync(opts.patchPath, patched.text);
    }
    console.error(JSON.stringify({ IU_CJ_STAGING_D1_PATCH: "OK", D1_ID_PATCHED: opts.dryRun ? "dry_run" : "yes" }));
    return;
  }
  process.stdout.write(resolved.id);
}

if (process.argv[1] && process.argv[1].endsWith("iu-cj-affiliate-staging-d1-resolve-v1.mjs")) {
  main().catch((e) => {
    console.error(JSON.stringify({ IU_CJ_STAGING_D1_RESOLVE: "FAIL", reason: String(e?.message || e) }));
    process.exit(1);
  });
}
