#!/usr/bin/env node
/**
 * CI entry for EXECUTE_GROWTH_ACTIVATION → GITHUB_ENV arming overlay.
 * Default: refuse/disabled. Never writes projects/data. Never prints secrets/tokens.
 * Production nonce store: durable HTTP/D1 only (IU_CJ_GROWTH_NONCE_STORE_URL + TOKEN).
 * Never falls back to RUNNER_TEMP when GITHUB_ACTIONS=true.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeGrowthActivation,
  resolvePublicGrowthUncappedGate,
} from "./iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8.mjs";

function appendGithubEnv(overlay, env = process.env) {
  const ghEnv = env.GITHUB_ENV;
  if (!ghEnv || !overlay || typeof overlay !== "object") return false;
  const lines = Object.entries(overlay)
    .filter(([, v]) => v != null && String(v).length)
    .map(([k, v]) => `${k}=${v}`);
  if (!lines.length) return false;
  fs.appendFileSync(ghEnv, lines.join("\n") + "\n");
  return true;
}

function explicitReady(value) {
  return value === true;
}

function maskToken(t) {
  const s = String(t || "");
  if (!s) return null;
  return `len=${s.length};sha16=${crypto.createHash("sha256").update(s).digest("hex").slice(0, 16)}`;
}

export async function runExecuteGrowthActivationCi(opts = {}) {
  const env = opts.env || process.env;
  const dryRunRaw = opts.dryRun ?? env.IU_CJ_GROWTH_EXECUTE_DRY_RUN ?? "1";
  const dryRun = !(dryRunRaw === false || String(dryRunRaw).trim() === "0");
  const enabledRaw = opts.enabled ?? env.IU_CJ_GROWTH_EXECUTE_ENABLED ?? "0";
  const enabled = enabledRaw === true || String(enabledRaw).trim() === "1";
  const token = String(opts.ownerApprovalToken ?? env.IU_CJ_GROWTH_OWNER_APPROVAL_TOKEN_INPUT ?? "").trim();
  const generationId = String(opts.generationId ?? env.IU_CJ_GROWTH_EXPECTED_GENERATION_ID ?? "").trim();
  const mainSha = String(opts.mainSha ?? env.IU_CJ_GROWTH_EXPECTED_MAIN_SHA ?? env.GITHUB_SHA ?? "").trim();
  const outPath = opts.outPath || env.IU_CJ_GROWTH_EXECUTE_OUT || null;

  if (!enabled) {
    const doc = {
      schema: "iu-cj-execute-growth-activation-ci-v1",
      at: new Date().toISOString(),
      refused: true,
      reason: "EXECUTE_DISABLED",
      wroteProjectsData: false,
      githubEnvWritten: false,
      note: "Set IU_CJ_GROWTH_EXECUTE_ENABLED=1 only with explicit owner approval dispatch.",
    };
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
    }
    return doc;
  }

  // Production Actions / default CI: durable HTTP/D1 required. Selftests may set allowInsecureLocal+sqlite.
  const allowInsecureLocal = opts.allowInsecureLocal === true;
  const result = await executeGrowthActivation({
    ownerApprovalToken: token,
    hmacSecret: env.IU_CJ_GROWTH_OWNER_APPROVAL_HMAC || env.IU_CJ_GROWTH_OWNER_APPROVAL_TOKEN,
    generationId,
    mainSha,
    dryRun,
    firstBatchMax: 25,
    backupPlanReady: explicitReady(opts.backupPlanReady),
    requiredCiPass: explicitReady(opts.requiredCiPass),
    pagesPass: explicitReady(opts.pagesPass),
    joinedRegistryPass: explicitReady(opts.joinedRegistryPass),
    czEligibilityPass: explicitReady(opts.czEligibilityPass),
    paidPositionsPass: explicitReady(opts.paidPositionsPass),
    stopMechanismPass: explicitReady(opts.stopMechanismPass),
    rollbackReady: explicitReady(opts.rollbackReady),
    requiredActor: env.IU_CJ_GROWTH_OWNER_ACTORS || undefined,
    actor: env.GITHUB_ACTOR,
    requireDurable: allowInsecureLocal ? false : true,
    allowInsecureLocal,
    nonceStore: opts.nonceStore,
    nonceSqlitePath: opts.nonceSqlitePath,
    nonceStoreUrl: opts.nonceStoreUrl || env.IU_CJ_GROWTH_NONCE_STORE_URL,
    nonceStoreToken: opts.nonceStoreToken || env.IU_CJ_GROWTH_NONCE_STORE_TOKEN,
    env,
    armReceiptPath: opts.armReceiptPath || env.IU_CJ_GROWTH_ARM_RECEIPT_PATH || undefined,
  });

  let githubEnvWritten = false;
  if (
    dryRun === false &&
    result.executed === true &&
    result.pipelineArming?.envOverlay &&
    resolvePublicGrowthUncappedGate(env.IU_CJ_PUBLIC_GROWTH_UNCAPPED)
  ) {
    githubEnvWritten = appendGithubEnv(result.pipelineArming.envOverlay, env) === true;
  }

  const doc = {
    schema: "iu-cj-execute-growth-activation-ci-v1",
    at: new Date().toISOString(),
    dryRun,
    enabled: true,
    refused: result.refused === true,
    executed: result.executed === true,
    reason: result.reason,
    wroteProjectsData: result.wroteProjectsData === true,
    productionWrite: result.productionWrite || "NO_PRODUCTION_WRITE",
    githubEnvWritten,
    firstBatchMax: result.firstBatchMax || 25,
    authConsumed: result.auth?.consumed === true,
    nonceStoreKind: result.auth?.nonceStoreKind || null,
    nonceStoreDurable: result.auth?.nonceStoreDurable === true,
    tokenFingerprint: maskToken(token),
    gate: resolvePublicGrowthUncappedGate(env.IU_CJ_PUBLIC_GROWTH_UNCAPPED) ? "1" : "0",
    note: "CI bridge only — durable nonce required on Actions; does not write projects/data.",
  };
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  }
  return doc;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const doc = await runExecuteGrowthActivationCi({});
  console.log(JSON.stringify(doc));
  if (String(process.env.IU_CJ_GROWTH_EXECUTE_ENABLED || "0") === "1") {
    const ok =
      doc.reason === "DRY_RUN_OK" ||
      doc.reason === "ARMED_FOR_CATALOG_SYNC" ||
      doc.reason === "EXECUTE_DISABLED";
    if (!ok) process.exitCode = 2;
  }
}
