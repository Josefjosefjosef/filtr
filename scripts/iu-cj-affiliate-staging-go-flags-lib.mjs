/**
 * Staging CJ probe GO flags — single source of truth helpers (wrangler.toml [env.staging.vars]).
 * Never logs secrets/PAT. Fail-closed allowlist for probe lock keys.
 */

export const STAGING_GO_FLAG_KEYS = Object.freeze([
  "IU_CJ_STAGING_CJ_API_PROBE_APPROVED",
  "IU_CJ_CJ_API_HTTP_EXECUTE",
  "IU_CJ_STAGING_CJ_API_PROBE_EXECUTE",
]);

export const STAGING_GO_RELATED_KEYS = Object.freeze([
  ...STAGING_GO_FLAG_KEYS,
  "IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE",
  "IU_CJ_STAGING_PROBE_LOCK_KEY",
]);

export const STAGING_PROBE_LOCK_KEYS_ALLOWED = Object.freeze([
  "link_search_coupon_v1",
  "link_search_coupon_v2",
]);

export const STAGING_GO_DISARMED_VARS = Object.freeze({
  IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "0",
  IU_CJ_CJ_API_HTTP_EXECUTE: "0",
  IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "0",
  IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE: "1",
  IU_CJ_STAGING_PROBE_LOCK_KEY: "link_search_coupon_v1",
});

/**
 * @param {string} lockKey
 * @returns {{ ok: true, lockKey: string } | { ok: false, reason: string }}
 */
export function resolveAllowedProbeLockKey(lockKey) {
  const key = String(lockKey ?? "").trim();
  if (!key) return { ok: false, reason: "probe_lock_key_empty" };
  if (!STAGING_PROBE_LOCK_KEYS_ALLOWED.includes(key)) {
    return { ok: false, reason: "probe_lock_key_not_allowed" };
  }
  return { ok: true, lockKey: key };
}

/**
 * @param {string} lockKey allowlisted
 * @returns {Record<string, string>}
 */
export function buildArmedStagingGoVars(lockKey) {
  const resolved = resolveAllowedProbeLockKey(lockKey);
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }
  return {
    IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "1",
    IU_CJ_CJ_API_HTTP_EXECUTE: "1",
    IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "1",
    IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE: "1",
    IU_CJ_STAGING_PROBE_LOCK_KEY: resolved.lockKey,
  };
}

/**
 * Detect dual-source GO management (toml missing GO keys while runtime expects --var).
 * @param {Record<string, string>} tomlVars
 * @param {{ usedKeepVarsCli?: boolean, usedVarCliForGo?: boolean }} runtime
 */
export function diagnoseGoFlagsSourceOfTruth(tomlVars = {}, runtime = {}) {
  const missingInToml = STAGING_GO_FLAG_KEYS.filter((k) => !(k in (tomlVars || {})));
  const dualSource =
    missingInToml.length > 0 &&
    (runtime.usedKeepVarsCli === true || runtime.usedVarCliForGo === true);
  return {
    dualSource,
    missingInToml,
    failClosedDefault:
      missingInToml.length > 0
        ? "unset_go_flags_fail_closed_but_unstable_under_keep_vars_var"
        : "toml_authoritative",
    recommended: "toml_env_staging_vars_authoritative_no_keep_vars_go_cli",
  };
}

/**
 * Match a TOML table header line: `[table]` or array-of-tables `[[table]]`.
 * IMPORTANT: `^\[[^\]]+\]$` does NOT match `[[env.staging.d1_databases]]` (trailing `]`),
 * which previously caused vars patch to swallow D1/R2 sections into plain env vars.
 */
export const TOML_TABLE_HEADER_RE = /^\[{1,2}[^\[\]]+\]{1,2}\s*$/m;

/**
 * @param {string} text
 * @returns {number} index of next header or -1
 */
export function findNextTomlTableHeader(text) {
  const m = TOML_TABLE_HEADER_RE.exec(String(text || ""));
  return m ? m.index : -1;
}

/**
 * Apply/replace keys inside a TOML [env.staging.vars] table body (multiline).
 * Returns full file text. Preserves following `[[env.staging.*]]` array tables.
 * @param {string} wranglerToml
 * @param {Record<string, string>} patch
 */
export function applyEnvStagingVarsPatch(wranglerToml, patch) {
  const text = String(wranglerToml || "");
  const tableRe = /^\[env\.staging\.vars\]\s*$/m;
  const tableMatch = tableRe.exec(text);
  if (!tableMatch) {
    throw new Error("env_staging_vars_table_missing");
  }
  const start = tableMatch.index + tableMatch[0].length;
  const rest = text.slice(start);
  const nextHeader = findNextTomlTableHeader(rest);
  const body = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
  const after = nextHeader === -1 ? "" : rest.slice(nextHeader);

  const lines = body.split(/\r?\n/);
  const map = new Map();
  const order = [];
  for (const line of lines) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (!m) continue;
    if (!map.has(m[1])) order.push(m[1]);
    map.set(m[1], m[2]);
  }
  for (const [k, v] of Object.entries(patch || {})) {
    if (!map.has(k)) order.push(k);
    map.set(k, String(v));
  }
  const rendered = order.map((k) => `${k} = "${map.get(k)}"`).join("\n");
  const prefix = text.slice(0, start).replace(/\s*$/, "\n");
  const suffix = after ? `\n${after.replace(/^\s*/, "")}` : "\n";
  return `${prefix}${rendered}\n${suffix}`;
}

/**
 * Parse [env.staging.vars] key/values from wrangler.toml text (string values only).
 * @param {string} wranglerToml
 * @returns {Record<string, string>}
 */
export function parseEnvStagingVars(wranglerToml) {
  const text = String(wranglerToml || "");
  const tableRe = /^\[env\.staging\.vars\]\s*$/m;
  const tableMatch = tableRe.exec(text);
  if (!tableMatch) return {};
  const start = tableMatch.index + tableMatch[0].length;
  const rest = text.slice(start);
  const nextHeader = findNextTomlTableHeader(rest);
  const body = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
  const out = {};
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Convert legacy inline `vars = { ... }` under [env.staging] into [env.staging.vars] table.
 * @param {string} wranglerToml
 */
export function ensureEnvStagingVarsTable(wranglerToml) {
  const text = String(wranglerToml || "");
  if (/^\[env\.staging\.vars\]\s*$/m.test(text)) return text;

  const inlineRe =
    /(\[env\.staging\][^\n]*\n(?:[^\[]*\n)*?)vars\s*=\s*\{([^}]*)\}\s*\n/;
  const m = inlineRe.exec(text);
  if (!m) {
    throw new Error("env_staging_inline_vars_missing");
  }
  const inlineBody = m[2];
  const pairs = [];
  const pairRe = /([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g;
  let pm;
  while ((pm = pairRe.exec(inlineBody))) {
    pairs.push([pm[1], pm[2]]);
  }
  if (!pairs.length) throw new Error("env_staging_inline_vars_empty");

  const tableLines = ["[env.staging.vars]", ...pairs.map(([k, v]) => `${k} = "${v}"`), ""];
  const withoutInline = text.replace(inlineRe, `$1`);
  // Insert table after [env.staging] block account_id / name lines — append before first [[env.staging.
  const insertAt = withoutInline.search(/^\[\[env\.staging\./m);
  if (insertAt === -1) {
    return `${withoutInline.trimEnd()}\n\n${tableLines.join("\n")}\n`;
  }
  return `${withoutInline.slice(0, insertAt)}${tableLines.join("\n")}\n${withoutInline.slice(insertAt)}`;
}
