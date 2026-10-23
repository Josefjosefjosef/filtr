#!/usr/bin/env node
/**
 * Fail-closed parser for `wrangler d1 migrations list --remote` (staging deploy gate).
 * Offline-safe: no wrangler, no D1 network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function listMigrationFiles(text) {
  const re = /\b(\d{4}_[A-Za-z0-9_.-]+\.sql)\b/g;
  const files = [];
  for (const match of String(text).matchAll(re)) {
    files.push(match[1]);
  }
  return [...new Set(files)];
}

/**
 * @param {{ exitCode: number, stdout: string, stderr?: string }} input
 * @returns {{ status: 'PASS' | 'BLOCKED', pendingCount: number | null, reason: string }}
 */
export function evaluateWranglerD1MigrationsListGate(input) {
  const exitCode = Number(input.exitCode);
  const stdout = String(input.stdout ?? "");
  const stderr = String(input.stderr ?? "");
  const combined = `${stdout}\n${stderr}`;

  if (!Number.isFinite(exitCode) || exitCode !== 0) {
    return { status: "BLOCKED", pendingCount: null, reason: "wrangler_exit_nonzero" };
  }

  if (/no migrations to apply/i.test(combined)) {
    return { status: "PASS", pendingCount: 0, reason: "no_migrations_to_apply" };
  }

  const unique = listMigrationFiles(combined);

  if (unique.length > 0) {
    return {
      status: "BLOCKED",
      pendingCount: unique.length,
      reason: "pending_migrations_listed",
    };
  }

  if (/error|failed|not authorized|authentication|invalid/i.test(combined)) {
    return { status: "BLOCKED", pendingCount: null, reason: "wrangler_error_output" };
  }

  const trimmed = combined.trim();
  if (!trimmed) {
    return { status: "BLOCKED", pendingCount: null, reason: "empty_wrangler_output" };
  }

  return { status: "BLOCKED", pendingCount: null, reason: "ambiguous_wrangler_output" };
}

function readCliInput(argv) {
  let exitCode = 0;
  let filePath = "";
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--exit-code" && argv[i + 1]) {
      exitCode = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--file" && argv[i + 1]) {
      filePath = argv[i + 1];
      i += 1;
    }
  }
  const stdout = filePath ? fs.readFileSync(filePath, "utf8") : fs.readFileSync(0, "utf8");
  return { exitCode, stdout, stderr: "" };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const input = readCliInput(process.argv);
  const result = evaluateWranglerD1MigrationsListGate(input);
  if (result.status === "PASS") {
    console.log(`CJ_STAGING_D1_MIGRATIONS_PENDING=${result.pendingCount}`);
    console.log("CJ_STAGING_D1_MIGRATIONS_GATE=PASS");
    process.exit(0);
  }
  console.log(`BLOCKER=CJ_STAGING_D1_MIGRATIONS_${result.reason.toUpperCase()}`);
  if (result.pendingCount !== null) {
    console.log(`CJ_STAGING_D1_MIGRATIONS_PENDING=${result.pendingCount}`);
  }
  console.log("CJ_STAGING_D1_MIGRATIONS_GATE=BLOCKED");
  process.exit(1);
}
