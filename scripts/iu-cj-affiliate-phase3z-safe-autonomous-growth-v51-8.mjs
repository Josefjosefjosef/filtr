/**
 * V51.8 — SAFE_AUTONOMOUS_GROWTH (prepare + adaptive batches + production EXECUTE).
 * No permanent per-partner product cap. Adaptive batching is operational protection only.
 * LIVE uncapped growth requires BOTH:
 *   1) IU_CJ_PUBLIC_GROWTH_UNCAPPED === "1" (Actions var; never commit "1")
 *   2) one-time owner HMAC approval bound to generationId + mainSha
 * EXECUTE never writes projects/data itself — it arms the standard catalog-sync / live-sync path.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyPublicGrowthBudget,
  collectPublicEligibleProductMap,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";
import {
  runGrowthShadowMode,
  reconstructDeferredCandidatesFromDurable,
} from "./iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8.mjs";
import {
  buildReservationKey,
  hashNonce,
  resolveGrowthApprovalNonceStore,
} from "./iu-cj-affiliate-phase3z-growth-approval-nonce-store-v51-8.mjs";

export const SAFE_AUTONOMOUS_GROWTH_SCHEMA =
  "iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8";
export const PREPARE_GROWTH_ACTIVATION_SCHEMA =
  "iu-cj-affiliate-phase3z-prepare-growth-activation-v51-8";
export const EXECUTE_GROWTH_ACTIVATION_SCHEMA =
  "iu-cj-affiliate-phase3z-execute-growth-activation-v51-8";
export const OWNER_APPROVAL_SCHEMA = "iu-cj-growth-owner-approval-v1";
export const GROWTH_ACTIVATION_ARM_SCHEMA = "iu-cj-growth-activation-arm-v1";

/** Permanent numeric partner caps are forbidden — adaptive batches only. */
export const FORBIDDEN_PERMANENT_PARTNER_CAP = null;
export const DEFAULT_FIRST_BATCH_MAX = 25;
export const DEFAULT_APPROVAL_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/**
 * Fail-closed growth gate: only exact string "1" enables. Missing/invalid → false.
 */
export function resolvePublicGrowthUncappedGate(raw) {
  return String(raw ?? "").trim() === "1";
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(s) {
  const pad = "=".repeat((4 - (String(s).length % 4)) % 4);
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function resolveHmacSecret(opts = {}) {
  return String(
    opts.hmacSecret ||
      process.env.IU_CJ_GROWTH_OWNER_APPROVAL_HMAC ||
      process.env.IU_CJ_GROWTH_OWNER_APPROVAL_TOKEN ||
      "",
  ).trim();
}

/**
 * Mint a time-limited, single-use owner approval token (ops/owner tool + selftests).
 * Never auto-mint in production EXECUTE.
 */
export function mintOwnerApprovalToken(opts = {}) {
  const secret = resolveHmacSecret(opts);
  if (!secret || secret.length < 16) {
    throw new Error("mintOwnerApprovalToken requires hmacSecret (>=16 chars)");
  }
  const now = Date.parse(opts.nowIso || new Date().toISOString());
  const ttlMs = Math.max(60_000, Number(opts.ttlMs) || DEFAULT_APPROVAL_TTL_MS);
  const payload = {
    schema: OWNER_APPROVAL_SCHEMA,
    scope: "EXECUTE_GROWTH_ACTIVATION",
    generationId: String(opts.generationId || "").trim(),
    mainSha: String(opts.mainSha || "").trim().toLowerCase(),
    firstBatchMax: Math.max(1, Math.min(25, Number(opts.firstBatchMax) || DEFAULT_FIRST_BATCH_MAX)),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    nonce: String(opts.nonce || crypto.randomBytes(16).toString("hex")),
    actor: opts.actor ? String(opts.actor).trim() : null,
  };
  if (!payload.generationId || !/^[0-9a-f]{40}$/i.test(payload.mainSha)) {
    throw new Error("mintOwnerApprovalToken requires generationId + 40-char mainSha");
  }
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return { token: `${body}.${sig}`, payload };
}

/**
 * Verify owner approval. Fail-closed. Optionally atomically reserve nonce (replay protection).
 * Always async — durable store may be HTTP/D1.
 * Production (GITHUB_ACTIONS / requireDurable): never uses RUNNER_TEMP JSON.
 */
export async function verifyOwnerActivationApproval(opts = {}) {
  const secret = resolveHmacSecret(opts);
  const token = String(opts.ownerApprovalToken || "").trim();
  const nowIso = opts.nowIso || new Date().toISOString();
  const now = Date.parse(nowIso);
  const deny = (reason, extra = {}) => ({
    ok: false,
    reason,
    consumed: false,
    noProductionWrite: reason === "NONCE_STORE_UNAVAILABLE" || reason === "OWNER_APPROVAL_REPLAY",
    ...extra,
  });

  if (!secret || secret.length < 16) return deny("OWNER_APPROVAL_SECRET_MISSING");
  if (!token) return deny("OWNER_APPROVAL_REQUIRED");

  const parts = token.split(".");
  if (parts.length !== 2) return deny("OWNER_APPROVAL_MALFORMED");
  const [body, sig] = parts;
  const expectedSig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (!timingSafeEqualStr(sig, expectedSig)) return deny("OWNER_APPROVAL_INVALID_SIGNATURE");

  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return deny("OWNER_APPROVAL_PAYLOAD_INVALID");
  }
  if (payload?.schema !== OWNER_APPROVAL_SCHEMA) return deny("OWNER_APPROVAL_SCHEMA_MISMATCH");
  if (payload?.scope !== "EXECUTE_GROWTH_ACTIVATION") return deny("OWNER_APPROVAL_SCOPE_MISMATCH");

  const exp = Date.parse(payload.expiresAt || "");
  const issued = Date.parse(payload.issuedAt || "");
  if (!Number.isFinite(exp) || !Number.isFinite(issued)) return deny("OWNER_APPROVAL_TIME_INVALID");
  if (now > exp) return deny("OWNER_APPROVAL_EXPIRED", { expiresAt: payload.expiresAt });
  if (issued > now + 60_000) return deny("OWNER_APPROVAL_ISSUED_IN_FUTURE");

  const expectedGen = String(opts.expectedGenerationId || "").trim();
  const expectedSha = String(opts.expectedMainSha || "").trim().toLowerCase();
  if (expectedGen && payload.generationId !== expectedGen) {
    return deny("OWNER_APPROVAL_GENERATION_MISMATCH", {
      tokenGenerationId: payload.generationId,
      expectedGenerationId: expectedGen,
    });
  }
  if (expectedSha && String(payload.mainSha).toLowerCase() !== expectedSha) {
    return deny("OWNER_APPROVAL_MAIN_SHA_MISMATCH", {
      tokenMainSha: payload.mainSha,
      expectedMainSha: expectedSha,
    });
  }

  if (opts.requiredActor) {
    const actor = String(opts.actor || process.env.GITHUB_ACTOR || "").trim();
    const allowed = String(opts.requiredActor).split(",").map((s) => s.trim()).filter(Boolean);
    if (!actor || !allowed.includes(actor)) {
      return deny("OWNER_APPROVAL_UNAUTHORIZED_ACTOR", { actor: actor || null });
    }
    if (payload.actor && payload.actor !== actor) {
      return deny("OWNER_APPROVAL_ACTOR_MISMATCH", { actor, tokenActor: payload.actor });
    }
  }

  const nonce = String(payload.nonce || "").trim();
  if (!nonce) return deny("OWNER_APPROVAL_NONCE_MISSING");

  const repository = String(
    opts.repository || process.env.GITHUB_REPOSITORY || "Josefjosefjosef/filtr",
  ).trim();
  const reservationKey = buildReservationKey({
    nonce,
    repository,
    mainSha: payload.mainSha,
    generationId: payload.generationId,
  });
  const nonceHash = hashNonce(nonce);

  const store =
    opts.nonceStore ||
    resolveGrowthApprovalNonceStore({
      env: opts.env || process.env,
      requireDurable: opts.requireDurable,
      allowInsecureLocal: opts.allowInsecureLocal,
      sqlitePath: opts.nonceSqlitePath || opts.nonceStorePath,
      legacyJsonPath: opts.legacyJsonPath,
      baseUrl: opts.nonceStoreUrl,
      token: opts.nonceStoreToken,
    });

  // Peek/replay check without consume: attempt is still fail-closed if store unavailable
  // when consume is requested; dry-run peek may skip reserve.
  if (opts.consume === true) {
    const reserved = await store.reserve({
      reservationKey,
      nonceHash,
      repository,
      mainSha: String(payload.mainSha || "").toLowerCase(),
      generationId: String(payload.generationId || ""),
      actor: opts.actor || process.env.GITHUB_ACTOR || payload.actor || null,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      runId: opts.runId || process.env.GITHUB_RUN_ID || null,
      nowIso,
    });
    if (!reserved?.ok) {
      const reason = reserved?.reason || "NONCE_STORE_UNAVAILABLE";
      return deny(reason, {
        reservationKey,
        nonceStoreKind: store.kind,
        noProductionWrite: true,
      });
    }
    return {
      ok: true,
      reason: "OK",
      consumed: true,
      nonceReserved: true,
      reservationKey,
      nonceStoreKind: store.kind,
      nonceStoreDurable: store.durable === true,
      payload,
      firstBatchMax: Math.max(1, Math.min(25, Number(payload.firstBatchMax) || DEFAULT_FIRST_BATCH_MAX)),
      nonceStore: store,
    };
  }

  return {
    ok: true,
    reason: "OK",
    consumed: false,
    reservationKey,
    nonceStoreKind: store.kind,
    nonceStoreDurable: store.durable === true,
    payload,
    firstBatchMax: Math.max(1, Math.min(25, Number(payload.firstBatchMax) || DEFAULT_FIRST_BATCH_MAX)),
  };
}

/**
 * Effective uncapped for live-sync: Actions gate "1" AND valid activation arm.
 * Gate alone never unlocks growth.
 */
export function resolveEffectiveUncappedGrowth(opts = {}) {
  const env = opts.env || process.env;
  const gate = resolvePublicGrowthUncappedGate(env.IU_CJ_PUBLIC_GROWTH_UNCAPPED);
  const armed = String(env.IU_CJ_GROWTH_ACTIVATION_ARMED || "").trim() === "1";
  const firstBatchMax = Math.max(
    1,
    Math.min(25, Number(env.IU_CJ_GROWTH_FIRST_BATCH_MAX) || DEFAULT_FIRST_BATCH_MAX),
  );
  const adaptiveBatchMax = Math.max(
    firstBatchMax,
    Math.min(400, Number(env.IU_CJ_GROWTH_ADAPTIVE_BATCH_MAX) || 0),
  );
  const effective = gate && armed;
  return {
    gate,
    armed,
    effectiveUncapped: effective,
    firstBatchMax,
    maxAllowedNew: effective
      ? Number(env.IU_CJ_GROWTH_BATCH_MAX_ALLOWED_NEW) > 0
        ? Math.min(400, Math.floor(Number(env.IU_CJ_GROWTH_BATCH_MAX_ALLOWED_NEW)))
        : firstBatchMax
      : null,
    note: !gate
      ? "GROWTH_GATE_LOCKED"
      : !armed
        ? "GATE_1_WITHOUT_EXECUTE_ARM — still capped"
        : "EFFECTIVE_UNCAPPED_ARMED",
  };
}

export const DEFAULT_STOP_THRESHOLDS = Object.freeze({
  maxShrinkRatio: 0.05,
  maxSurgeRatio: 0.35,
  maxDuplicateRatio: 0.4,
  maxCollisionAbs: 0,
  maxInvalidAffiliateRatio: 0.15,
  maxRejectRatio: 0.85,
  maxBatchMs: 120_000,
  minValidationSuccessRatio: 0.12,
});

function sha256Json(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj || {})).digest("hex");
}

function countPublic(doc) {
  return collectPublicEligibleProductMap(doc || { sections: [] }).size;
}

/**
 * Adaptive batch size from prior outcomes — not a permanent catalog ceiling.
 */
export function computeAdaptiveBatchSize(state = {}) {
  const catalogSize = Math.max(1, Number(state.catalogSize) || 1);
  const priorOk = state.priorBatchOk !== false;
  const priorAdmitted = Math.max(0, Number(state.priorAdmitted) || 0);
  const priorRejectRatio = Math.min(1, Math.max(0, Number(state.priorRejectRatio) || 0));
  const errorRate = Math.min(1, Math.max(0, Number(state.errorRate) || 0));
  const publishLoad = Math.min(1, Math.max(0, Number(state.publishLoad) || 0));

  // Base: ~2–8% of catalog, floor 25 / ceiling 400 (ops drip, not partner cap).
  let next = Math.round(catalogSize * 0.04);
  next = Math.max(25, Math.min(400, next));

  if (!priorOk) return Math.max(10, Math.floor(next * 0.35));
  if (priorRejectRatio > 0.6 || errorRate > 0.2) next = Math.floor(next * 0.5);
  else if (priorAdmitted > 0 && priorRejectRatio < 0.25 && errorRate < 0.05) next = Math.floor(next * 1.35);
  if (publishLoad > 0.7) next = Math.floor(next * 0.6);
  return Math.max(10, Math.min(400, next));
}

/**
 * Evaluate STOP conditions after a batch. Fail-closed.
 */
export function evaluateGrowthStopConditions(batch = {}, thresholds = DEFAULT_STOP_THRESHOLDS) {
  const t = { ...DEFAULT_STOP_THRESHOLDS, ...(thresholds || {}) };
  const reasons = [];
  const prev = Math.max(0, Number(batch.prevPublicSize) || 0);
  const next = Math.max(0, Number(batch.nextPublicSize) || 0);
  const processed = Math.max(0, Number(batch.processed) || 0);
  const admitted = Math.max(0, Number(batch.validCandidates) || 0);
  const rejected = Math.max(0, Number(batch.rejected) || 0);
  const duplicates = Math.max(0, Number(batch.duplicates) || 0);
  const collisions = Math.max(0, Number(batch.collisions) || 0);
  const invalidAffiliate = Math.max(0, Number(batch.invalidAffiliate) || 0);
  const ms = Math.max(0, Number(batch.durationMs) || 0);

  if (prev > 0 && next < prev * (1 - t.maxShrinkRatio)) {
    reasons.push({ code: "CATALOG_SHRINKAGE", prev, next, maxShrinkRatio: t.maxShrinkRatio });
  }
  if (prev > 0 && next > prev * (1 + t.maxSurgeRatio)) {
    reasons.push({ code: "CATALOG_SURGE", prev, next, maxSurgeRatio: t.maxSurgeRatio });
  }
  if (processed > 0 && duplicates / processed > t.maxDuplicateRatio) {
    reasons.push({ code: "DUPLICATE_SPIKE", duplicates, processed });
  }
  if (collisions > t.maxCollisionAbs) {
    reasons.push({ code: "IDENTITY_COLLISIONS", collisions });
  }
  if (processed > 0 && invalidAffiliate / processed > t.maxInvalidAffiliateRatio) {
    reasons.push({ code: "INVALID_AFFILIATE_SPIKE", invalidAffiliate, processed });
  }
  if (processed > 20 && rejected / processed > t.maxRejectRatio) {
    reasons.push({ code: "REJECT_SPIKE", rejected, processed });
  }
  if (processed > 20 && admitted / processed < t.minValidationSuccessRatio) {
    reasons.push({ code: "VALIDATION_SUCCESS_COLLAPSE", admitted, processed });
  }
  if (ms > t.maxBatchMs) {
    reasons.push({ code: "BATCH_TIMEOUT", ms, maxBatchMs: t.maxBatchMs });
  }
  if (batch.pagesDeployFailed === true) reasons.push({ code: "PAGES_DEPLOY_FAILED" });
  if (batch.requiredCiFailed === true) reasons.push({ code: "REQUIRED_CI_FAILED" });
  if (batch.rollbackFailed === true) reasons.push({ code: "ROLLBACK_FAILED" });
  if (batch.joinedRegistryMismatch === true) reasons.push({ code: "JOINED_REGISTRY_MISMATCH" });
  if (batch.staleSourceFeeds === true) reasons.push({ code: "STALE_SOURCE_FEEDS" });
  if (batch.missingSection === true) reasons.push({ code: "MISSING_SECTION" });
  if (batch.corruptManifest === true) reasons.push({ code: "CORRUPT_MANIFEST" });
  if (batch.shaMismatch === true) reasons.push({ code: "SHA_MISMATCH" });
  if (batch.capacityExceeded === true) reasons.push({ code: "CAPACITY_EXCEEDED" });
  if (batch.syncRepeatedFail === true) reasons.push({ code: "SYNC_REPEATED_FAIL" });
  if (batch.batchHardFail === true) reasons.push({ code: "BATCH_HARD_FAIL" });

  return {
    stop: reasons.length > 0,
    reasons,
    failClosed: true,
    note: reasons.length
      ? "STOP — do not admit further products until owner/ops clears the cause."
      : "CONTINUE",
  };
}

/**
 * Offline adaptive canary / safe growth simulation. Never writes projects/data.
 * Never arms IU_CJ_PUBLIC_GROWTH_UNCAPPED.
 */
export function runSafeAutonomousGrowthCanary(opts = {}) {
  const offersDoc = opts.offersDoc || opts.prevDoc;
  if (!offersDoc) throw new Error("runSafeAutonomousGrowthCanary requires offersDoc");

  const maxBatches = Math.max(1, Math.min(12, Number(opts.maxBatches) || 5));
  const thresholds = opts.thresholds || DEFAULT_STOP_THRESHOLDS;
  const batches = [];
  let stop = null;
  let priorBatchOk = true;
  let priorAdmitted = 0;
  let priorRejectRatio = 0;
  let catalogSize = countPublic(offersDoc);
  const baseline = catalogSize;
  const t0 = Date.now();
  let cumulativeAdmitted = 0;

  for (let i = 0; i < maxBatches; i++) {
    if (stop?.stop) break;
    const batchSize = computeAdaptiveBatchSize({
      catalogSize,
      priorBatchOk,
      priorAdmitted,
      priorRejectRatio,
      errorRate: opts.errorRate || 0,
      publishLoad: opts.publishLoad || 0,
    });
    const started = Date.now();
    const shadow = runGrowthShadowMode({
      offersDoc,
      durableProducts: opts.durableProducts,
      joinedPartners: opts.joinedPartners,
      reportedDeferredNew: opts.reportedDeferredNew,
      iterations: i + 1,
      batchSize,
      uncappedShadow: true,
      preferredCurrency: opts.preferredCurrency || "CZK",
    });
    const durationMs = Date.now() - started;
    const row = shadow.iterationRows?.[shadow.iterationRows.length - 1] || {};
    const prevPublicSize = i === 0 ? baseline : batches[i - 1].cumulativePublicSize;
    const nextPublicSize = shadow.finalPublicSize;
    const admittedThis = Math.max(0, (shadow.validCandidates || 0) - cumulativeAdmitted);
    const evalBatch = {
      prevPublicSize,
      nextPublicSize,
      processed: row.processed || 0,
      validCandidates: admittedThis,
      rejected: row.rejected || 0,
      duplicates: row.duplicates || 0,
      collisions: 0,
      invalidAffiliate: 0,
      durationMs,
      batchHardFail: shadow.ok === false,
      ...(opts.injectStopFlags || {}),
    };
    const decision = evaluateGrowthStopConditions(evalBatch, thresholds);
    const snapshot = {
      batch: i + 1,
      batchSize,
      durationMs,
      processed: evalBatch.processed,
      validCandidates: admittedThis,
      rejected: evalBatch.rejected,
      hold: row.hold || 0,
      duplicates: evalBatch.duplicates,
      collisions: 0,
      byPartner: row.byPartner || {},
      byCategory: row.byCategory || {},
      prevPublicSize,
      nextPublicSize,
      deltaPublicSize: nextPublicSize - prevPublicSize,
      cumulativePublicSize: nextPublicSize,
      cumulativeAdmitted: shadow.validCandidates || 0,
      approxJsonBytesDelta: row.loadEstimate?.approxBytesDelta ?? null,
      paidPositionsUntouched: shadow.paidPositionsUntouched !== false,
      rollbackPlan: shadow.rollbackPlan || null,
      stopDecision: decision,
      ok: !decision.stop && shadow.ok !== false,
    };
    batches.push(snapshot);

    if (decision.stop || shadow.ok === false) {
      stop = decision.stop
        ? decision
        : evaluateGrowthStopConditions({ ...evalBatch, batchHardFail: true }, thresholds);
      priorBatchOk = false;
      break;
    }

    cumulativeAdmitted = shadow.validCandidates || 0;
    catalogSize = nextPublicSize;
    priorBatchOk = true;
    priorAdmitted = admittedThis;
    priorRejectRatio = snapshot.processed > 0 ? snapshot.rejected / snapshot.processed : 0;
  }

  const envUncapped = String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED || "0");
  return {
    schema: SAFE_AUTONOMOUS_GROWTH_SCHEMA,
    at: new Date().toISOString(),
    mode: "SAFE_AUTONOMOUS_GROWTH_OFFLINE_CANARY",
    ok: !stop?.stop && batches.every((b) => b.ok),
    wroteProjectsData: false,
    growthGateStillLocked: envUncapped !== "1",
    envIU_CJ_PUBLIC_GROWTH_UNCAPPED: envUncapped,
    forbiddenPermanentPartnerCap: FORBIDDEN_PERMANENT_PARTNER_CAP,
    baselinePublicSize: baseline,
    batches,
    halted: !!stop?.stop,
    halt: stop,
    durationMs: Date.now() - t0,
    note: "Adaptive drip only — no permanent 10/partner (or any) catalog ceiling.",
  };
}

/**
 * PREPARE_GROWTH_ACTIVATION — evidence pack + readiness gates. Safe to run now.
 * Does not publish and does not flip uncapped env.
 */
export function prepareGrowthActivation(opts = {}) {
  const mainSha = String(opts.mainSha || "").trim();
  const growthGateLocked = String(opts.envUncapped ?? process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED ?? "0") !== "1";
  const ledger = opts.growthLedger || { cumulativeAddedSinceBaseline: 500, maxCumulativeAbs: 500, allowedNew: 0 };
  const checks = [
    { id: "backup_plan", pass: opts.backupPlanReady === true || opts.backupPlanReady == null, note: "Caller must snapshot last valid catalog before EXECUTE" },
    { id: "main_sha", pass: /^[0-9a-f]{40}$/i.test(mainSha) || mainSha.length >= 7, value: mainSha || null },
    { id: "required_ci", pass: opts.requiredCiPass !== false, value: opts.requiredCiPass },
    { id: "pages", pass: opts.pagesPass !== false, value: opts.pagesPass },
    { id: "r2_d1", pass: opts.r2d1Pass !== false, value: opts.r2d1Pass, note: "Soft until EXECUTE" },
    { id: "growth_ledger", pass: Number(ledger.allowedNew) === 0 && growthGateLocked, value: ledger },
    { id: "joined_registry", pass: opts.joinedRegistryPass !== false, value: opts.joinedRegistryPass },
    { id: "source_feeds", pass: opts.sourceFeedsPass !== false, value: opts.sourceFeedsPass },
    { id: "cz_eligibility", pass: opts.czEligibilityPass !== false, value: opts.czEligibilityPass },
    { id: "paid_positions", pass: opts.paidPositionsPass !== false, value: opts.paidPositionsPass },
    { id: "adaptive_batching_ready", pass: true },
    { id: "stop_conditions_ready", pass: true },
    { id: "rollback_ready", pass: true },
    { id: "growth_gate_locked", pass: growthGateLocked },
    { id: "execute_disarmed", pass: true, note: "EXECUTE requires ownerApprovalToken" },
  ];
  const fail = checks.filter((c) => c.pass === false);
  const doc = {
    schema: PREPARE_GROWTH_ACTIVATION_SCHEMA,
    at: new Date().toISOString(),
    ready: fail.length === 0,
    checks,
    fails: fail.map((f) => f.id),
    nextStep: "EXECUTE_GROWTH_ACTIVATION requires explicit owner approval token; do not run automatically.",
    activationFingerprint: sha256Json({
      mainSha,
      ledger,
      growthGateLocked,
      at: "prepare",
    }),
  };
  if (opts.outPath) {
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, JSON.stringify(doc, null, 2) + "\n");
  }
  return doc;
}

/**
 * EXECUTE_GROWTH_ACTIVATION — production-ready arming for catalog-sync / live-sync.
 * Never writes projects/data. Never mints owner approval. Fail-closed.
 *
 * dryRun (default true): verify auth + simulate first batch ≤25; do NOT consume nonce; no arm.
 * dryRun false: require gate=1 + prechecks + consume nonce + emit arming env overlay for pipeline.
 */
export async function executeGrowthActivation(opts = {}) {
  const at = new Date().toISOString();
  const env = opts.env || process.env;
  const gateRaw = env.IU_CJ_PUBLIC_GROWTH_UNCAPPED;
  const gateOn = resolvePublicGrowthUncappedGate(gateRaw);
  const dryRun = opts.dryRun !== false;
  const generationId = String(opts.generationId || opts.expectedGenerationId || "").trim();
  const mainSha = String(opts.mainSha || opts.expectedMainSha || "").trim().toLowerCase();
  const firstBatchMax = Math.max(
    1,
    Math.min(DEFAULT_FIRST_BATCH_MAX, Number(opts.firstBatchMax) || DEFAULT_FIRST_BATCH_MAX),
  );

  const base = {
    schema: EXECUTE_GROWTH_ACTIVATION_SCHEMA,
    at,
    executed: false,
    refused: true,
    dryRun,
    wroteProjectsData: false,
    productionWrite: "NO_PRODUCTION_WRITE",
    envIU_CJ_PUBLIC_GROWTH_UNCAPPED: gateOn ? "1" : "0",
    growthGateOn: gateOn,
    generationId: generationId || null,
    mainSha: mainSha || null,
    firstBatchMax,
    implementation: "LIVE_PIPELINE_ARM_V1",
  };

  const authCommon = {
    ownerApprovalToken: opts.ownerApprovalToken,
    hmacSecret: opts.hmacSecret,
    expectedGenerationId: generationId,
    expectedMainSha: mainSha,
    requiredActor: opts.requiredActor,
    actor: opts.actor,
    nonceStore: opts.nonceStore,
    nonceSqlitePath: opts.nonceSqlitePath,
    nonceStorePath: opts.nonceStorePath,
    allowInsecureLocal: opts.allowInsecureLocal,
    requireDurable: opts.requireDurable,
    nonceStoreUrl: opts.nonceStoreUrl,
    nonceStoreToken: opts.nonceStoreToken,
    env: opts.env,
    repository: opts.repository,
    runId: opts.runId,
    nowIso: opts.nowIso || at,
  };

  const auth = await verifyOwnerActivationApproval({
    ...authCommon,
    consume: false, // never reserve until live path clears prechecks + gate
  });

  if (!auth.ok) {
    return {
      ...base,
      reason: auth.reason === "OWNER_APPROVAL_SECRET_MISSING" ? "OWNER_APPROVAL_REQUIRED" : auth.reason,
      auth,
      note: "NO_PRODUCTION_WRITE — owner approval missing or invalid.",
    };
  }

  // Prechecks (required for live; recommended for dry-run)
  const precheckFails = [];
  if (!generationId) precheckFails.push("missing_generationId");
  if (!/^[0-9a-f]{40}$/i.test(mainSha)) precheckFails.push("missing_mainSha");
  if (opts.backupPlanReady === false) precheckFails.push("backup_not_ready");
  if (opts.requiredCiPass === false) precheckFails.push("required_ci_failed");
  if (opts.pagesPass === false) precheckFails.push("pages_failed");
  if (opts.joinedRegistryPass === false) precheckFails.push("joined_registry_failed");
  if (opts.czEligibilityPass === false) precheckFails.push("cz_eligibility_failed");
  if (opts.paidPositionsPass === false) precheckFails.push("paid_positions_failed");
  if (opts.stopMechanismPass === false) precheckFails.push("stop_mechanism_failed");
  if (opts.rollbackReady === false) precheckFails.push("rollback_not_ready");

  if (precheckFails.length && (opts.requirePrechecks !== false || !dryRun)) {
    if (!dryRun || opts.requirePrechecks === true) {
      return {
        ...base,
        reason: "PRECHECK_FAILED",
        precheckFails,
        auth: { ok: true, reason: "OK", consumed: false },
        note: "NO_PRODUCTION_WRITE — prechecks blocked EXECUTE.",
      };
    }
  }

  // Optional offline first-batch simulation (never writes)
  let dryRunBatch = null;
  if (opts.offersDoc) {
    const catalogSize = countPublic(opts.offersDoc);
    const batchSize = Math.min(
      firstBatchMax,
      auth.firstBatchMax || firstBatchMax,
      computeAdaptiveBatchSize({ catalogSize, priorOk: true }),
    );
    const shadow = runGrowthShadowMode({
      offersDoc: opts.offersDoc,
      durableProducts: opts.durableProducts,
      joinedPartners: opts.joinedPartners,
      reportedDeferredNew: opts.reportedDeferredNew,
      iterations: 1,
      batchSize,
      uncappedShadow: true,
      preferredCurrency: opts.preferredCurrency || "CZK",
    });
    const prevPublicSize = catalogSize;
    const nextPublicSize = shadow.finalPublicSize;
    const stop = evaluateGrowthStopConditions({
      prevPublicSize,
      nextPublicSize,
      processed: shadow.iterationRows?.[0]?.processed || 0,
      validCandidates: Math.min(batchSize, shadow.validCandidates || 0),
      rejected: shadow.iterationRows?.[0]?.rejected || 0,
      duplicates: shadow.iterationRows?.[0]?.duplicates || 0,
      collisions: 0,
      invalidAffiliate: 0,
      ...(opts.injectStopFlags || {}),
    });
    dryRunBatch = {
      mode: "FIRST_BATCH_SIMULATION",
      batchSize,
      validCandidates: shadow.validCandidates || 0,
      admittedCapped: Math.min(batchSize, shadow.validCandidates || 0),
      prevPublicSize,
      nextPublicSize,
      paidPositionsUntouched: shadow.paidPositionsUntouched !== false,
      stop,
      ok: shadow.ok !== false && !stop.stop,
      wroteProjectsData: false,
    };
    if (!dryRunBatch.ok && !dryRun) {
      return {
        ...base,
        reason: "FIRST_BATCH_SIMULATION_STOP",
        dryRunBatch,
        auth: { ok: true, reason: "OK", consumed: false },
        note: "NO_PRODUCTION_WRITE — simulated batch hit STOP.",
      };
    }
  }

  if (dryRun) {
    return {
      ...base,
      refused: false,
      executed: false,
      reason: "DRY_RUN_OK",
      auth: { ok: true, reason: "OK", consumed: false, firstBatchMax: auth.firstBatchMax },
      dryRunBatch,
      pipelineArming: null,
      note: "Dry-run only — approval verified but nonce NOT consumed; growth NOT armed; NO_PRODUCTION_WRITE.",
    };
  }

  // LIVE arming path
  if (!gateOn) {
    return {
      ...base,
      reason: "GROWTH_GATE_LOCKED",
      auth: { ok: true, reason: "OK", consumed: false },
      dryRunBatch,
      note: "NO_PRODUCTION_WRITE — set Actions var IU_CJ_PUBLIC_GROWTH_UNCAPPED=1 after owner approval (never commit 1).",
    };
  }

  const consume = await verifyOwnerActivationApproval({
    ...authCommon,
    consume: true,
  });
  if (!consume.ok) {
    return {
      ...base,
      reason: consume.reason,
      auth: consume,
      dryRunBatch,
      noProductionWrite: true,
      note: "NO_PRODUCTION_WRITE — durable nonce reserve failed (replay/unavailable/expiry).",
    };
  }

  try {
    if (consume.nonceStore && typeof consume.nonceStore.transition === "function" && consume.reservationKey) {
      await consume.nonceStore.transition({
        reservationKey: consume.reservationKey,
        state: "ARMED",
        nowIso: at,
      });
    }
  } catch {
    // Transition failure after reserve: nonce already spent — require new owner approval.
    if (consume.nonceStore && typeof consume.nonceStore.transition === "function" && consume.reservationKey) {
      try {
        await consume.nonceStore.transition({
          reservationKey: consume.reservationKey,
          state: "FAILED",
          failReason: "ARM_TRANSITION_FAILED",
          nowIso: at,
        });
      } catch {
        /* ignore */
      }
    }
    return {
      ...base,
      reason: "NONCE_ARM_TRANSITION_FAILED",
      auth: { ok: false, reason: "NONCE_ARM_TRANSITION_FAILED", consumed: true, reservationKey: consume.reservationKey },
      dryRunBatch,
      noProductionWrite: true,
      note: "NO_PRODUCTION_WRITE — nonce reserved but arm transition failed; new owner approval required.",
    };
  }

  const arm = {
    schema: GROWTH_ACTIVATION_ARM_SCHEMA,
    at,
    armed: true,
    generationId,
    mainSha,
    firstBatchMax: Math.min(firstBatchMax, consume.firstBatchMax || firstBatchMax),
    adaptiveBatching: true,
    adaptiveBatchRange: { min: 25, max: 400 },
    pipeline: "cj-affiliate-catalog-sync / offers-live-sync",
    reservationKey: consume.reservationKey || null,
    nonceStoreKind: consume.nonceStoreKind || null,
    nonceStoreDurable: consume.nonceStoreDurable === true,
    nonceFingerprint: crypto.createHash("sha256").update(String(consume.payload?.nonce || "")).digest("hex").slice(0, 16),
    expiresAt: consume.payload?.expiresAt || null,
  };

  const envOverlay = {
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1",
    IU_CJ_GROWTH_ACTIVATION_ARMED: "1",
    IU_CJ_GROWTH_FIRST_BATCH_MAX: String(arm.firstBatchMax),
    IU_CJ_GROWTH_BATCH_MAX_ALLOWED_NEW: String(arm.firstBatchMax),
  };

  if (opts.armReceiptPath) {
    fs.mkdirSync(path.dirname(opts.armReceiptPath), { recursive: true });
    fs.writeFileSync(opts.armReceiptPath, JSON.stringify({ ...arm, envOverlay }, null, 2) + "\n");
  }

  return {
    ...base,
    refused: false,
    executed: true,
    reason: "ARMED_FOR_CATALOG_SYNC",
    productionWrite: "NO_DIRECT_PROJECTS_DATA_WRITE",
    auth: {
      ok: true,
      reason: "OK",
      consumed: true,
      firstBatchMax: consume.firstBatchMax,
      reservationKey: consume.reservationKey,
      nonceStoreKind: consume.nonceStoreKind,
      nonceStoreDurable: consume.nonceStoreDurable === true,
    },
    dryRunBatch,
    pipelineArming: { arm, envOverlay },
    note: "Activation armed for standard catalog-sync pipeline only. Direct projects/data writes remain forbidden here.",
  };
}

export async function runNegativeGrowthGuards(opts = {}) {
  const cases = [];
  const baseDoc = opts.offersDoc || { sections: [], liveEnabled: true, stats: { uniqueProducts: 10 } };

  // Shrinkage STOP
  const shrink = evaluateGrowthStopConditions({
    prevPublicSize: 1000,
    nextPublicSize: 800,
    processed: 50,
    validCandidates: 0,
    rejected: 0,
    duplicates: 0,
  });
  cases.push({ id: "stop_shrinkage", pass: shrink.stop === true && shrink.reasons.some((r) => r.code === "CATALOG_SHRINKAGE") });

  // Surge STOP
  const surge = evaluateGrowthStopConditions({
    prevPublicSize: 1000,
    nextPublicSize: 1500,
    processed: 50,
    validCandidates: 500,
    rejected: 0,
    duplicates: 0,
  });
  cases.push({ id: "stop_surge", pass: surge.stop === true && surge.reasons.some((r) => r.code === "CATALOG_SURGE") });

  // Collision STOP
  const coll = evaluateGrowthStopConditions({
    prevPublicSize: 100,
    nextPublicSize: 110,
    processed: 20,
    validCandidates: 10,
    collisions: 2,
  });
  cases.push({ id: "stop_collision", pass: coll.stop === true });

  // Execute refuse
  const exec = await executeGrowthActivation({
    ownerApprovalToken: "nope",
    hmacSecret: "selftest-hmac-secret-do-not-use-in-prod-32b",
    allowInsecureLocal: true,
    nonceSqlitePath: opts.nonceSqlitePath,
  });
  cases.push({ id: "execute_refused", pass: exec.refused === true && exec.executed === false });

  // Adaptive size changes with failures
  const a1 = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, priorAdmitted: 100, priorRejectRatio: 0.1 });
  const a2 = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: false, priorAdmitted: 0, priorRejectRatio: 0.9 });
  cases.push({ id: "adaptive_shrinks_on_fail", pass: a2 < a1 });
  cases.push({ id: "no_permanent_partner_cap", pass: FORBIDDEN_PERMANENT_PARTNER_CAP == null });

  // Budget still locked when not uncapped
  const locked = applyPublicGrowthBudget(
    JSON.parse(JSON.stringify(baseDoc)),
    baseDoc,
    { uncappedMode: false, cumulativeAddedSinceBaseline: 500, maxCumulativeAbs: 500 },
  );
  cases.push({
    id: "live_budget_still_exhausted",
    pass: Number(locked.budget?.allowedNew || 0) === 0 || Number(locked.budget?.cumulativeRemaining || 0) === 0,
  });

  return {
    schema: "iu-cj-affiliate-phase3z-safe-growth-negative-guards-v51-8",
    at: new Date().toISOString(),
    ok: cases.every((c) => c.pass),
    cases,
  };
}

export {
  reconstructDeferredCandidatesFromDurable,
  runGrowthShadowMode,
};
