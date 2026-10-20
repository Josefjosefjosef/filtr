#!/usr/bin/env node
/**
 * Production PWA external-return delivery audit (HTTP + optional runtime boot id).
 * Build id is authoritative in assets/iu-network-connectivity-v1.js; HTML cache-bust must align.
 */
export const PWA_EXTERNAL_RETURN_UNIFIED_BUILD_RE =
  /pwa-external-return-unified-v\d+-\d{8}-[\w-]+/;
const PWA_EXTERNAL_RETURN_UNIFIED_BUILD_RE_GLOBAL =
  /pwa-external-return-unified-v\d+-\d{8}-[\w-]+/g;

const NETWORK_SCRIPT_SRC_RE = /iu-network-connectivity-v1\.js\?v=([^"']+)/;
const BUILD_ID_CONST_RE = /PWA_EXTERNAL_RETURN_BUILD_ID\s*=\s*"([^"]+)"/;

export function extractUnifiedBuildIds(text) {
  const raw = String(text || "");
  if (!raw) return [];
  const chunks = raw.split("pwa-external-return-unified-v");
  const out = [];
  for (let i = 1; i < chunks.length; i++) {
    const m = chunks[i].match(/^(\d+)-(\d{8})-([\w-]+)/);
    if (!m) continue;
    const id = "pwa-external-return-unified-v" + m[1] + "-" + m[2] + "-" + m[3];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function parseNetworkScriptVParam(rootHtml) {
  const m = String(rootHtml || "").match(NETWORK_SCRIPT_SRC_RE);
  return m ? m[1] : "";
}

export function parseNetworkBuildIdFromJs(netJsText) {
  const m = String(netJsText || "").match(BUILD_ID_CONST_RE);
  return m ? m[1] : "";
}

export function buildNetworkScriptUrl(origin, scriptV) {
  const base = String(origin || "").replace(/\/$/, "");
  if (scriptV) {
    return new URL("/assets/iu-network-connectivity-v1.js?v=" + scriptV, base + "/").href;
  }
  return base + "/assets/iu-network-connectivity-v1.js";
}

/**
 * @param {object} input
 * @param {number} input.rootStatus
 * @param {string} input.rootHtml
 * @param {number} input.netJsStatus
 * @param {string} input.netJsText
 * @param {string} [input.runtimeBootBuildId] - window.iuNetwork.pwaExternalReturnBuildId when available
 * @param {object} [input.options]
 * @param {string} [input.options.pinBuildId] - IU_PWA_DELIVERY_PIN_BUILD_ID strict pin
 */
export function evaluateExternalReturnProdDelivery(input) {
  const failures = [];
  const rootStatus = input.rootStatus ?? 0;
  const rootHtml = input.rootHtml ?? "";
  const netJsStatus = input.netJsStatus ?? 0;
  const netJsText = input.netJsText ?? "";
  const pinBuildId = (input.options && input.options.pinBuildId) || "";

  if (rootStatus !== 200) failures.push("root_http_not_ok");
  if (!rootHtml.trim()) failures.push("root_html_empty");

  const scriptV = parseNetworkScriptVParam(rootHtml);
  if (!scriptV) failures.push("missing_network_script_tag");

  const buildId = parseNetworkBuildIdFromJs(netJsText);
  if (!buildId) failures.push("missing_build_id_constant");
  else if (!PWA_EXTERNAL_RETURN_UNIFIED_BUILD_RE.test(buildId)) failures.push("invalid_build_id_format");

  if (netJsStatus !== 200) failures.push("network_script_http_not_ok");
  if (netJsStatus === 200 && !netJsText.trim()) failures.push("network_script_empty");

  if (buildId && scriptV && !scriptV.includes(buildId)) {
    failures.push("html_cache_bust_build_mismatch");
  }

  const htmlUnifiedInTag = extractUnifiedBuildIds(scriptV);
  if (htmlUnifiedInTag.length > 1) failures.push("html_mixed_unified_build_ids");
  if (buildId && htmlUnifiedInTag.length === 1 && htmlUnifiedInTag[0] !== buildId) {
    failures.push("html_unified_token_js_constant_mismatch");
  }

  if (netJsText && !/function restoreAppShellAfterReturn\s*\(/.test(netJsText)) {
    failures.push("missing_restore_app_shell_api");
  }
  if (netJsText && !/function enableExternalReturnDiagPanel\s*\(/.test(netJsText)) {
    failures.push("missing_external_return_diag_api");
  }
  if (netJsText && !/startExternalMainScrollRestoreCoordinated|bootRestoreExternalMainScrollAfterDocumentLoad/.test(netJsText)) {
    failures.push("missing_coordinated_scroll_restore");
  }
  if (netJsText && !/openExternalSync/.test(netJsText)) {
    failures.push("missing_open_external_sync");
  }

  if (pinBuildId && buildId && buildId !== pinBuildId) {
    failures.push("pinned_build_mismatch");
  }

  const runtimeBootBuildId = input.runtimeBootBuildId;
  if (runtimeBootBuildId && buildId && runtimeBootBuildId !== buildId) {
    failures.push("runtime_boot_build_mismatch");
  }

  return {
    pass: failures.length === 0,
    failures,
    buildId: buildId || "",
    scriptV,
    htmlUnifiedBuildIds: htmlUnifiedInTag,
  };
}

export function aggregateReturnScenariosPass(mobileBucket) {
  if (!mobileBucket) return false;
  const home = mobileBucket.home && mobileBucket.home.pass;
  const menu = mobileBucket.menu && mobileBucket.menu.pass;
  const mind = mobileBucket.mind && mobileBucket.mind.pass;
  return !!(home && menu && mind);
}

export function formatDeliveryLogLines(evalResult, meta = {}) {
  const lines = [];
  lines.push("DELIVERY_ROOT_URL=" + (meta.rootUrl || ""));
  lines.push("DELIVERY_NET_URL=" + (meta.netUrl || ""));
  lines.push("DELIVERY_NET_BUILD=" + (evalResult.buildId || "MISSING"));
  lines.push("DELIVERY_HTML_SCRIPT_V=" + (evalResult.scriptV ? "present" : "missing"));
  lines.push(
    "DELIVERY_HTML_BUILD_ALIGNED=" + (evalResult.failures.includes("html_cache_bust_build_mismatch") ||
    evalResult.failures.includes("html_unified_token_js_constant_mismatch")
      ? "no"
      : evalResult.buildId && evalResult.scriptV && evalResult.scriptV.includes(evalResult.buildId)
        ? "yes"
        : "no")
  );
  lines.push("DELIVERY_FAILURES=" + (evalResult.failures.length ? evalResult.failures.join(",") : "none"));
  return lines;
}
