/**
 * Staging Worker post-deploy health — full HTTP+parse+assertions retry (read-only).
 * Never logs secrets/PAT. Fail-closed on unknown/invalid payloads.
 */

export const STAGING_POSTDEPLOY_HEALTH_DEFAULTS = Object.freeze({
  maxAttempts: 12,
  sleepMs: 2500,
});

/**
 * @param {unknown} payload
 * @param {{ expectedVersionId?: string | null }} [opts]
 * @returns {{ ok: boolean, reasons: string[], versionCheck: "match"|"mismatch"|"not_exposed"|"skipped" }}
 */
export function evaluateStagingPostDeployHealth(payload, opts = {}) {
  const reasons = [];
  if (payload === null || payload === undefined) {
    return { ok: false, reasons: ["payload_null"], versionCheck: "skipped" };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reasons: ["payload_not_object"], versionCheck: "skipped" };
  }
  const h = /** @type {Record<string, unknown>} */ (payload);

  if (h.ok !== true) reasons.push("ok_not_true");
  if (h.environment !== "staging") reasons.push("environment_not_staging");
  if (h.stagingOnly !== true) reasons.push("stagingOnly_not_true");
  if (h.cjArchiveOnly !== true) reasons.push("cjArchiveOnly_not_true");
  if (h.cjLiveApiRequestsAllowed !== false) reasons.push("cjLiveApiRequestsAllowed_not_false");
  if (h.publishable !== false) reasons.push("publishable_not_false");
  if (h.d1Binding !== "present") reasons.push("d1Binding_not_present");
  if (h.r2Binding !== "present") reasons.push("r2Binding_not_present");

  const expected = String(opts.expectedVersionId || "").trim();
  let versionCheck = "skipped";
  if (expected) {
    const exposed = h.versionId ?? h.deploymentId ?? h.workerVersionId ?? null;
    if (exposed === null || exposed === undefined || exposed === "") {
      versionCheck = "not_exposed";
    } else if (String(exposed) === expected) {
      versionCheck = "match";
    } else {
      versionCheck = "mismatch";
      reasons.push("version_mismatch");
    }
  }

  return { ok: reasons.length === 0, reasons, versionCheck };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, payload: object } | { ok: false, reason: string }}
 */
export function parseHealthJsonSafe(raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: "body_empty" };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ok: true, payload: raw };
  }
  const text = String(raw).trim();
  if (!text) return { ok: false, reason: "body_empty" };
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: "json_not_object" };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: "json_invalid" };
  }
}

/**
 * One attempt: fetch → parse → assert. No CJ API.
 * @param {{
 *   fetchHealth: () => Promise<{ status: number, body: string|object, error?: string }>,
 *   expectedVersionId?: string | null,
 * }} args
 */
export async function attemptStagingPostDeployHealth(args) {
  let fetched;
  try {
    fetched = await args.fetchHealth();
  } catch (e) {
    return {
      ok: false,
      phase: "fetch",
      reasons: ["fetch_threw"],
      detail: String(e && e.message ? e.message : e),
      versionCheck: "skipped",
    };
  }
  if (fetched && fetched.error) {
    return {
      ok: false,
      phase: "fetch",
      reasons: ["fetch_error"],
      detail: String(fetched.error),
      status: fetched.status,
      versionCheck: "skipped",
    };
  }
  const status = Number(fetched?.status);
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    return {
      ok: false,
      phase: "http",
      reasons: ["http_not_2xx"],
      status,
      versionCheck: "skipped",
    };
  }
  const parsed = parseHealthJsonSafe(fetched.body);
  if (!parsed.ok) {
    return {
      ok: false,
      phase: "parse",
      reasons: [parsed.reason],
      status,
      versionCheck: "skipped",
    };
  }
  const evaled = evaluateStagingPostDeployHealth(parsed.payload, {
    expectedVersionId: args.expectedVersionId,
  });
  return {
    ok: evaled.ok,
    phase: "assert",
    reasons: evaled.reasons,
    status,
    versionCheck: evaled.versionCheck,
    payloadSafe: {
      ok: parsed.payload.ok,
      environment: parsed.payload.environment,
      stagingOnly: parsed.payload.stagingOnly,
      cjArchiveOnly: parsed.payload.cjArchiveOnly,
      cjLiveApiRequestsAllowed: parsed.payload.cjLiveApiRequestsAllowed,
      publishable: parsed.payload.publishable,
      d1Binding: parsed.payload.d1Binding,
      r2Binding: parsed.payload.r2Binding,
    },
  };
}

/**
 * Retry full request+parse+assertions until pass or attempts exhausted.
 * @param {{
 *   fetchHealth: () => Promise<{ status: number, body: string|object, error?: string }>,
 *   expectedVersionId?: string | null,
 *   maxAttempts?: number,
 *   sleepMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} args
 */
export async function runStagingPostDeployHealthRetry(args) {
  const maxAttempts = Math.max(
    1,
    Number(args.maxAttempts ?? STAGING_POSTDEPLOY_HEALTH_DEFAULTS.maxAttempts) ||
      STAGING_POSTDEPLOY_HEALTH_DEFAULTS.maxAttempts
  );
  const sleepMs = Math.max(
    0,
    Number(args.sleepMs ?? STAGING_POSTDEPLOY_HEALTH_DEFAULTS.sleepMs) ||
      STAGING_POSTDEPLOY_HEALTH_DEFAULTS.sleepMs
  );
  const sleep =
    args.sleep ||
    ((ms) => new Promise((r) => setTimeout(r, ms)));

  /** @type {object[]} */
  const attempts = [];
  for (let i = 1; i <= maxAttempts; i += 1) {
    const result = await attemptStagingPostDeployHealth({
      fetchHealth: args.fetchHealth,
      expectedVersionId: args.expectedVersionId,
    });
    attempts.push({ attempt: i, ...result });
    if (result.ok) {
      return {
        ok: true,
        attempts,
        passedOnAttempt: i,
        last: result,
      };
    }
    if (i < maxAttempts && sleepMs > 0) {
      await sleep(sleepMs);
    }
  }
  return {
    ok: false,
    attempts,
    passedOnAttempt: null,
    last: attempts[attempts.length - 1],
    reason: "retry_exhausted",
  };
}
