#!/usr/bin/env node
/** Offline readiness gates: live ingest and publication remain disabled by default. */
import { resolveLiveIngestGate } from "./iu-cj-affiliate-phase2-github-actions-ingest-live-gate.mjs";
import { resolveCjApiConfig } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import { isForpsiImapLiveConnectApproved } from "./iu-forpsi-imap-credentials-interface.mjs";
import { resolveStagingCjArchiveGate } from "./iu-cj-affiliate-phase2-staging-archive-only-gate.mjs";

const env = {
  ...process.env,
  PRODUCTION_SIGNING_ENABLED: "false",
  ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED: "false",
  ADS_PUBLIC_DELIVERY_ENABLED: "false",
  ADS_SAFE_MODE: "true",
  IU_CJ_EMAIL_INGEST_OFFLINE: "1",
  IU_CJ_LIVE_INGEST_APPROVED: "0",
};

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const live = resolveLiveIngestGate(env);
expect("live_ingest_disabled", live.allowed === false);
expect("offline_forced_or_gates", live.offlineForced === true || live.gates.liveApproved === false);
expect("forpsi_live_blocked", isForpsiImapLiveConnectApproved() === false);
expect("prod_signing_off", live.gates.productionSigningOff === true);

const cj = resolveCjApiConfig(env);
expect("cj_api_no_live_without_pat", cj.enabled === false || cj.mode !== "live");

const archive = resolveStagingCjArchiveGate({
  ENVIRONMENT: "staging",
  IU_CJ_STAGING_ONLY: "1",
  CJ_STAGING_ARCHIVE_ONLY: "1",
});
expect("staging_archive_live_api_off", archive.mayExecuteHttp === false);

console.log(
  JSON.stringify({
    IU_CJ_CONNECTOR_READINESS_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    LIVE_INGEST_DISABLED: live.allowed === false,
    PUBLICATION_SAFE_FLAGS: {
      PRODUCTION_SIGNING_ENABLED: env.PRODUCTION_SIGNING_ENABLED,
      ADS_PUBLIC_DELIVERY_ENABLED: env.ADS_PUBLIC_DELIVERY_ENABLED,
      ADS_SAFE_MODE: env.ADS_SAFE_MODE,
    },
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
