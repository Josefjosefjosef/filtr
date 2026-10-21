/**
 * Staging Worker env contract — same binding names as wrangler `[env.staging]`.
 * Use in-memory mocks locally; swap to real D1/R2 at deploy without changing ingest libs.
 */
import { createInMemoryBannerR2Store } from "./iu-cj-affiliate-phase2-banner-staging-r2-lib.mjs";

export const STAGING_WORKER_BINDING_NAMES = Object.freeze({
  d1: "DB",
  bannerR2: "BANNER_ASSETS",
});

export const STAGING_WORKER_VARS = Object.freeze({
  environment: "ENVIRONMENT",
  stagingOnly: "IU_CJ_STAGING_ONLY",
  ingestToken: "IU_CJ_D1_WORKER_INGEST_TOKEN",
});

export function assertStagingWorkerBindings(env) {
  const missing = [];
  if (!env?.[STAGING_WORKER_BINDING_NAMES.d1]) missing.push(STAGING_WORKER_BINDING_NAMES.d1);
  if (!env?.[STAGING_WORKER_BINDING_NAMES.bannerR2]) missing.push(STAGING_WORKER_BINDING_NAMES.bannerR2);
  if (env?.[STAGING_WORKER_VARS.environment] !== "staging") missing.push(STAGING_WORKER_VARS.environment);
  if (env?.[STAGING_WORKER_VARS.stagingOnly] !== "1") missing.push(STAGING_WORKER_VARS.stagingOnly);
  return { ok: missing.length === 0, missing, publishable: false };
}

/** Minimal D1 stand-in for offline contract tests (not SQL-complete). */
export function createInMemoryD1BindingStub() {
  const tables = new Map();
  return {
    async prepare(sql) {
      return {
        async bind() {
          return this;
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
      };
    },
    _tables: tables,
  };
}

export function createMockStagingWorkerEnv(options = {}) {
  const bannerStore = options.bannerStore || createInMemoryBannerR2Store();
  const db = options.db || createInMemoryD1BindingStub();
  return {
    [STAGING_WORKER_VARS.environment]: "staging",
    [STAGING_WORKER_VARS.stagingOnly]: "1",
    [STAGING_WORKER_BINDING_NAMES.d1]: db,
    [STAGING_WORKER_BINDING_NAMES.bannerR2]: bannerStore,
    publishable: false,
  };
}
