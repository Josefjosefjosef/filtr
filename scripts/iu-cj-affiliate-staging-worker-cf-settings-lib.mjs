/**
 * Parse Cloudflare Workers script settings (read-only). Never log secret binding values.
 */
export const STAGING_IDENTITY_VAR_NAMES = Object.freeze({
  publisherCid: "IU_CJ_PUBLISHER_CID",
  websitePid: "IU_CJ_WEBSITE_PID",
});

const SECRET_BINDING_TYPES = new Set([
  "secret_text",
  "secret",
  "encrypted_text",
  "kv_namespace",
  "d1",
  "r2_bucket",
]);

/**
 * @param {unknown} json Parsed CF API JSON body
 * @returns {{ ok: true, plain: Map<string, string> } | { ok: false, reason: string, detail?: string }}
 */
export function extractPlainTextBindingsFromCfSettingsPayload(json) {
  if (json == null || typeof json !== "object") {
    return { ok: false, reason: "invalid_json_root" };
  }
  const root = /** @type {Record<string, unknown>} */ (json);
  if (root.success === false) {
    const errs = Array.isArray(root.errors) ? root.errors : [];
    const code = errs[0] && typeof errs[0] === "object" ? errs[0].code : undefined;
    return { ok: false, reason: "cf_api_success_false", detail: code != null ? String(code) : "errors_present" };
  }
  if (root.success !== true) {
    return { ok: false, reason: "cf_api_success_missing" };
  }
  const result = root.result;
  if (result == null || typeof result !== "object") {
    return { ok: false, reason: "missing_result" };
  }
  const bindings = /** @type {Record<string, unknown>} */ (result).bindings;
  if (!Array.isArray(bindings)) {
    return { ok: false, reason: "bindings_not_array" };
  }
  const plain = new Map();
  for (const raw of bindings) {
    if (raw == null || typeof raw !== "object") continue;
    const b = /** @type {Record<string, unknown>} */ (raw);
    const type = String(b.type || b.kind || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, "_");
    if (type !== "plain_text" && type !== "plaintext") continue;
    const name = String(b.name || "").trim();
    if (!name) continue;
    let text = "";
    if (b.text != null) text = String(b.text);
    else if (b.value != null) text = String(b.value);
    plain.set(name, text.trim());
  }
  return { ok: true, plain };
}

/**
 * @param {unknown} json
 * @param {{ publisherCid?: string, websitePid?: string }} expected
 */
export function auditStagingWorkerIdentityFromCfSettings(json, expected = {}) {
  const expCid = String(expected.publisherCid || "").trim();
  const expPid = String(expected.websitePid || "").trim();
  const extracted = extractPlainTextBindingsFromCfSettingsPayload(json);
  if (!extracted.ok) {
    return {
      ok: false,
      cjCfSettingsApi: "FAIL",
      publisherCid: "UNVERIFIED",
      websitePid: "UNVERIFIED",
      reason: extracted.reason,
      detail: extracted.detail || null,
    };
  }
  const hasCid = extracted.plain.has(STAGING_IDENTITY_VAR_NAMES.publisherCid);
  const hasPid = extracted.plain.has(STAGING_IDENTITY_VAR_NAMES.websitePid);
  const cid = hasCid ? extracted.plain.get(STAGING_IDENTITY_VAR_NAMES.publisherCid) : "";
  const pid = hasPid ? extracted.plain.get(STAGING_IDENTITY_VAR_NAMES.websitePid) : "";

  let publisherCid;
  if (!hasCid || cid === "") publisherCid = "MISSING";
  else if (expCid && cid !== expCid) publisherCid = "FAIL";
  else if (expCid && cid === expCid) publisherCid = "PASS";
  else publisherCid = "FAIL";

  let websitePid;
  if (!hasPid || pid === "") websitePid = "MISSING";
  else if (expPid && pid !== expPid) websitePid = "FAIL";
  else if (expPid && pid === expPid) websitePid = "PASS";
  else websitePid = "FAIL";

  const swapped =
    hasCid &&
    hasPid &&
    expCid &&
    expPid &&
    cid === expPid &&
    pid === expCid;

  const ok = publisherCid === "PASS" && websitePid === "PASS" && !swapped;
  return {
    ok,
    cjCfSettingsApi: "PASS",
    publisherCid: swapped ? "FAIL" : publisherCid,
    websitePid: swapped ? "FAIL" : websitePid,
    swapped: swapped ? true : undefined,
    reason: ok ? "ok" : swapped ? "cid_pid_swapped" : "identity_mismatch_or_missing",
  };
}

/** Safe summary for logs (no secret values). */
export function countBindingTypes(json) {
  const extracted = extractPlainTextBindingsFromCfSettingsPayload(json);
  if (!extracted.ok) return { parseOk: false, reason: extracted.reason };
  return {
    parseOk: true,
    plainTextCount: extracted.plain.size,
    hasPublisherCid: extracted.plain.has(STAGING_IDENTITY_VAR_NAMES.publisherCid),
    hasWebsitePid: extracted.plain.has(STAGING_IDENTITY_VAR_NAMES.websitePid),
  };
}

export function bindingTypesIncludeSecrets(json) {
  if (json == null || typeof json !== "object") return false;
  const root = /** @type {Record<string, unknown>} */ (json);
  const result = root.result;
  if (result == null || typeof result !== "object") return false;
  const bindings = /** @type {Record<string, unknown>} */ (result).bindings;
  if (!Array.isArray(bindings)) return false;
  for (const raw of bindings) {
    if (raw == null || typeof raw !== "object") continue;
    const type = String(/** @type {Record<string, unknown>} */ (raw).type || "")
      .trim()
      .toLowerCase();
    if (SECRET_BINDING_TYPES.has(type)) return true;
  }
  return false;
}
