/** Staging CJ API archive-only gates — no PAT values in responses or logs. */

const PAT_KEYS = ["CJ_API_PAT", "IU_CJ_PAT", "CJ_PERSONAL_ACCESS_TOKEN"];

export function trimPat(value) {
  const s = String(value || "").trim();
  return s.length ? s : "";
}

export function hasCjPatSecret(env) {
  for (const key of PAT_KEYS) {
    if (trimPat(env?.[key])) return true;
  }
  return false;
}

export function resolveStagingCjArchiveGate(env = {}) {
  const staging =
    env.ENVIRONMENT === "staging" && env.IU_CJ_STAGING_ONLY === "1";
  const archiveOnly = env.CJ_STAGING_ARCHIVE_ONLY === "1";
  const hasPat = hasCjPatSecret(env);
  const probeApproved = env.IU_CJ_STAGING_CJ_API_PROBE_APPROVED === "1";
  const httpExecute = env.IU_CJ_CJ_API_HTTP_EXECUTE === "1";
  const probeExecute = env.IU_CJ_STAGING_CJ_API_PROBE_EXECUTE === "1";
  const publisherCid = String(env.IU_CJ_PUBLISHER_CID || "").trim();
  const websitePid = String(env.IU_CJ_WEBSITE_PID || "").trim();
  const maxRequests = Math.min(
    5,
    Math.max(1, Number(env.IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE || 1))
  );

  const identityOk = validateCjPublisherIdentityFields(publisherCid, websitePid).ok;

  const mayExecuteHttp =
    staging &&
    archiveOnly &&
    hasPat &&
    probeApproved &&
    httpExecute &&
    probeExecute &&
    identityOk;

  let blockReason = "staging_archive_default_deny";
  if (!staging) blockReason = "not_staging_worker";
  else if (!archiveOnly) blockReason = "archive_only_flag_off";
  else if (!hasPat) blockReason = "cj_pat_secret_missing";
  else if (!probeApproved) blockReason = "probe_not_approved";
  else if (!httpExecute) blockReason = "http_execute_not_armed";
  else if (!probeExecute) blockReason = "probe_execute_not_armed";
  else if (!identityOk) blockReason = "publisher_identity_invalid";

  return {
    staging,
    archiveOnly,
    hasPatSecret: hasPat,
    probeApproved,
    httpExecuteArmed: httpExecute,
    probeExecuteArmed: probeExecute,
    publisherCidConfigured: publisherCid.length > 0,
    websitePidConfigured: websitePid.length > 0,
    identityOk,
    maxRequestsPerProbe: maxRequests,
    mayExecuteHttp,
    blockReason,
    publishable: false,
    liveCjApiRequestsAllowed: mayExecuteHttp,
  };
}

export function validateCjPublisherIdentityFields(publisherCid, websitePid) {
  const failures = [];
  const cid = String(publisherCid || "").trim();
  const pid = String(websitePid || "").trim();
  const numRe = /^\d{5,12}$/;
  if (cid && !numRe.test(cid)) failures.push("publisher_cid_format");
  if (pid && !numRe.test(pid)) failures.push("website_pid_format");
  if (cid && pid && cid === pid) failures.push("publisher_cid_equals_website_pid");
  return { ok: failures.length === 0, failures };
}

export function buildStagingCjApiReadiness(env) {
  const gate = resolveStagingCjArchiveGate(env);
  return {
    ok: true,
    phase: "cj_api_readiness",
    archiveOnly: gate.archiveOnly,
    hasPatSecret: gate.hasPatSecret,
    probeApproved: gate.probeApproved,
    httpExecuteArmed: gate.httpExecuteArmed,
    probeExecuteArmed: gate.probeExecuteArmed,
    identityOk: gate.identityOk,
    mayExecuteHttp: gate.mayExecuteHttp,
    blockReason: gate.blockReason,
    maxRequestsPerProbe: gate.maxRequestsPerProbe,
    publishable: false,
  };
}

export function redactCjAuditFields(obj) {
  const out = { ...(obj || {}) };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (lower.includes("pat") || lower.includes("token") || lower.includes("authorization")) {
      out[key] = "[redacted]";
    }
  }
  return out;
}
