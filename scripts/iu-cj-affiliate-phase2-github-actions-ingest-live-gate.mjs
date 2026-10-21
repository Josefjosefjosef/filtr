/** Multi-gate live ingest — single env flag is insufficient. */
import { isForpsiImapLiveConnectApproved } from "./iu-forpsi-imap-credentials-interface.mjs";
import { resolveD1WorkerConfig, validateIngestTokenFormat } from "./iu-cj-affiliate-phase2-cj-email-d1-worker-client.mjs";
import { resolveCjApiConfig } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import { resolveWorkersAiConfig } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";

export function resolveLiveIngestGate(env = process.env) {
  const offline = env.IU_CJ_EMAIL_INGEST_OFFLINE === "1" || env.IU_CJ_GITHUB_INGEST_DRY_RUN === "1";
  const liveApproved = env.IU_CJ_LIVE_INGEST_APPROVED === "1";
  const imapApproved = isForpsiImapLiveConnectApproved();
  const d1Cfg = resolveD1WorkerConfig(env);
  const d1Ready =
    env.IU_CJ_D1_BACKEND === "worker" &&
    d1Cfg.enabled &&
    Boolean(d1Cfg.baseUrl) &&
    validateIngestTokenFormat(d1Cfg.ingestToken).ok;
  const imapSecrets = Boolean(String(env.IU_FORPSI_IMAP_USER || "").trim() && String(env.IU_FORPSI_IMAP_SECRET || "").trim());
  const allowed = !offline && liveApproved && imapApproved && imapSecrets && d1Ready;
  return {
    allowed,
    offlineForced: offline,
    gates: {
      liveApproved,
      imapApproved,
      imapSecrets,
      d1WorkerReady: d1Ready,
      productionSigningOff: env.PRODUCTION_SIGNING_ENABLED !== "true",
    },
    cjApi: resolveCjApiConfig(env),
    workersAi: resolveWorkersAiConfig(env),
    note: "IU_CJ_LIVE_INGEST_APPROVED=1 alone does not enable live ingest",
  };
}
