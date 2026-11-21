#!/usr/bin/env node
/**
 * Mark growth approval nonce COMPLETED only after verified publication evidence.
 * Never completes from arming alone. Fail-closed when evidence insufficient.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCompletedPublicationEvidence,
} from "./iu-cj-affiliate-phase3z-growth-approval-nonce-lifecycle-v51-8.mjs";
import { resolveGrowthApprovalNonceStore } from "./iu-cj-affiliate-phase3z-growth-approval-nonce-store-v51-8.mjs";

export async function completeGrowthApprovalPublication(opts = {}) {
  const env = opts.env || process.env;
  const at = opts.nowIso || new Date().toISOString();
  const reservationKey = String(opts.reservationKey || env.IU_CJ_GROWTH_RESERVATION_KEY || "").trim();
  const operationId = String(opts.operationId || env.IU_CJ_GROWTH_OPERATION_ID || "").trim();
  const mainSha = String(opts.mainSha || env.IU_CJ_GROWTH_EXPECTED_MAIN_SHA || "").trim().toLowerCase();
  const generationId = String(
    opts.generationId || env.IU_CJ_GROWTH_EXPECTED_GENERATION_ID || "",
  ).trim();

  const evidence = evaluateCompletedPublicationEvidence({
    reservationKey,
    operationId,
    expectedOperationId: opts.expectedOperationId || operationId,
    mainSha,
    expectedMainSha: opts.expectedMainSha || mainSha,
    generationId,
    expectedGenerationId: opts.expectedGenerationId || generationId,
    requiredCiPass: opts.requiredCiPass === true,
    dataPrMerged: opts.dataPrMerged === true,
    pagesDeployPass: opts.pagesDeployPass === true,
    productionGenerationId: opts.productionGenerationId,
    contentSha: opts.contentSha,
    expectedContentSha: opts.expectedContentSha || opts.contentSha,
    publishedProductsVerified: opts.publishedProductsVerified === true,
  });

  const base = {
    schema: "iu-cj-growth-approval-complete-v51-8",
    at,
    reservationKey: reservationKey || null,
    operationId: operationId || null,
    completed: false,
    productionWrite: "NO_PRODUCTION_CATALOG_WRITE_FROM_COMPLETE_HELPER",
  };

  if (!evidence.ok) {
    return {
      ...base,
      reason: evidence.reason,
      evidenceFails: evidence.fails,
      note: "COMPLETED denied — publication evidence incomplete.",
    };
  }

  const store =
    opts.nonceStore ||
    resolveGrowthApprovalNonceStore({
      env,
      requireDurable: opts.requireDurable !== false,
      allowInsecureLocal: opts.allowInsecureLocal === true,
      sqlitePath: opts.nonceSqlitePath,
      baseUrl: opts.nonceStoreUrl || env.IU_CJ_GROWTH_NONCE_STORE_URL,
      token: opts.nonceStoreToken || env.IU_CJ_GROWTH_NONCE_STORE_TOKEN,
    });

  const tr = await store.transition({
    reservationKey,
    state: "COMPLETED",
    expectedMainSha: mainSha,
    expectedGenerationId: generationId,
    expectedOperationId: operationId,
    nowIso: at,
  });

  if (!tr?.ok) {
    return {
      ...base,
      reason: tr?.reason || "NONCE_STORE_UNAVAILABLE",
      note: "COMPLETED transition denied or store unavailable — nonce not re-armed.",
    };
  }

  return {
    ...base,
    completed: true,
    reason: "COMPLETED",
    state: "COMPLETED",
    from: tr.from || "ARMED",
    note: "Nonce marked COMPLETED after verified publication evidence.",
  };
}

export async function failGrowthApprovalPublication(opts = {}) {
  const env = opts.env || process.env;
  const at = opts.nowIso || new Date().toISOString();
  const reservationKey = String(opts.reservationKey || env.IU_CJ_GROWTH_RESERVATION_KEY || "").trim();
  const next = String(opts.state || "FAILED").toUpperCase() === "STOPPED" ? "STOPPED" : "FAILED";
  const store =
    opts.nonceStore ||
    resolveGrowthApprovalNonceStore({
      env,
      requireDurable: opts.requireDurable !== false,
      allowInsecureLocal: opts.allowInsecureLocal === true,
      sqlitePath: opts.nonceSqlitePath,
      baseUrl: opts.nonceStoreUrl || env.IU_CJ_GROWTH_NONCE_STORE_URL,
      token: opts.nonceStoreToken || env.IU_CJ_GROWTH_NONCE_STORE_TOKEN,
    });
  if (!reservationKey) {
    return { ok: false, reason: "missing_reservationKey", completed: false };
  }
  const tr = await store.transition({
    reservationKey,
    state: next,
    failReason: opts.failReason || "publication_failed",
    expectedMainSha: opts.expectedMainSha || env.IU_CJ_GROWTH_EXPECTED_MAIN_SHA,
    expectedGenerationId: opts.expectedGenerationId || env.IU_CJ_GROWTH_EXPECTED_GENERATION_ID,
    expectedOperationId: opts.operationId || env.IU_CJ_GROWTH_OPERATION_ID,
    nowIso: at,
  });
  return {
    schema: "iu-cj-growth-approval-fail-v51-8",
    at,
    ok: tr?.ok === true,
    reason: tr?.reason || "NONCE_STORE_UNAVAILABLE",
    state: next,
    reservationKey,
    completed: false,
  };
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const mode = String(process.env.IU_CJ_GROWTH_COMPLETE_MODE || "complete").trim();
  const doc =
    mode === "fail"
      ? await failGrowthApprovalPublication({})
      : await completeGrowthApprovalPublication({
          requiredCiPass: String(process.env.IU_CJ_GROWTH_EVIDENCE_REQUIRED_CI || "") === "1",
          dataPrMerged: String(process.env.IU_CJ_GROWTH_EVIDENCE_DATA_PR_MERGED || "") === "1",
          pagesDeployPass: String(process.env.IU_CJ_GROWTH_EVIDENCE_PAGES_PASS || "") === "1",
          productionGenerationId: process.env.IU_CJ_GROWTH_EVIDENCE_PROD_GENERATION_ID,
          contentSha: process.env.IU_CJ_GROWTH_EVIDENCE_CONTENT_SHA,
          publishedProductsVerified:
            String(process.env.IU_CJ_GROWTH_EVIDENCE_PRODUCTS_VERIFIED || "") === "1",
        });
  const outPath = process.env.IU_CJ_GROWTH_COMPLETE_OUT;
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  }
  console.log(JSON.stringify(doc));
  if (doc.completed !== true && mode === "complete") process.exitCode = 2;
}
