#!/usr/bin/env node
/** Negative + positive fixtures for prod external-return delivery audit (no network). */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateExternalReturnProdDelivery,
  aggregateReturnScenariosPass,
  buildNetworkScriptUrl,
} from "./iu-pwa-external-return-prod-delivery-v1.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOOD_BUILD = "pwa-external-return-unified-v16-20261016-export119-hub-boot-clear";
const OLD_BUILD = "pwa-external-return-unified-v13-20261014-scroll-coordinated";

function readNetSample() {
  return fs.readFileSync(path.join(REPO, "assets", "iu-network-connectivity-v1.js"), "utf8");
}

function htmlWithBuild(buildId, extraSuffix = "") {
  const v =
    "pwa-offline-menu-articles-v4-20260716-silver-p0-lazy-v1a-20260728-ds-external-return-fullscreen-v1-20260903-" +
    buildId +
    extraSuffix;
  return `<!doctype html><script defer src="/assets/iu-network-connectivity-v1.js?v=${v}"></script>`;
}

const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function caseDelivery(name, input, expectPass, expectFailureSubstr) {
  const r = evaluateExternalReturnProdDelivery(input);
  const passOk = r.pass === expectPass;
  must(passOk, name + ":pass");
  if (expectFailureSubstr) {
    const hit = r.failures.some((f) => f.includes(expectFailureSubstr) || f === expectFailureSubstr);
    must(hit, name + ":failure:" + expectFailureSubstr);
  }
}

function main() {
  const netGood = readNetSample();

  caseDelivery(
    "positive_repo_aligned",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood,
    },
    true,
    null
  );

  caseDelivery(
    "negative_missing_network_tag",
    { rootStatus: 200, rootHtml: "<html></html>", netJsStatus: 200, netJsText: netGood },
    false,
    "missing_network_script_tag"
  );

  caseDelivery(
    "negative_root_http",
    { rootStatus: 503, rootHtml: htmlWithBuild(GOOD_BUILD), netJsStatus: 200, netJsText: netGood },
    false,
    "root_http_not_ok"
  );

  caseDelivery(
    "negative_net_http",
    { rootStatus: 200, rootHtml: htmlWithBuild(GOOD_BUILD), netJsStatus: 404, netJsText: "" },
    false,
    "network_script_http_not_ok"
  );

  caseDelivery(
    "negative_missing_build_constant",
    { rootStatus: 200, rootHtml: htmlWithBuild(GOOD_BUILD), netJsStatus: 200, netJsText: "var x=1;" },
    false,
    "missing_build_id_constant"
  );

  caseDelivery(
    "negative_invalid_build_format",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild("not-a-valid-unified-build"),
      netJsStatus: 200,
      netJsText: 'var PWA_EXTERNAL_RETURN_BUILD_ID = "not-a-valid-unified-build";',
    },
    false,
    "invalid_build_id_format"
  );

  caseDelivery(
    "negative_html_js_mismatch",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(OLD_BUILD),
      netJsStatus: 200,
      netJsText: netGood,
    },
    false,
    "html_cache_bust_build_mismatch"
  );

  caseDelivery(
    "negative_mixed_html_unified_ids",
    {
      rootStatus: 200,
      rootHtml:
        '<!doctype html><script defer src="/assets/iu-network-connectivity-v1.js?v=' +
        OLD_BUILD +
        "-chain-" +
        GOOD_BUILD +
        '"></script>',
      netJsStatus: 200,
      netJsText: netGood,
    },
    false,
    "html_mixed_unified_build_ids"
  );

  caseDelivery(
    "negative_missing_restore_api",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood.replace(/function restoreAppShellAfterReturn/g, "function restoreAppShellAfterReturn_REMOVED"),
    },
    false,
    "missing_restore_app_shell_api"
  );

  caseDelivery(
    "negative_missing_diag_api",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood.replace(/function enableExternalReturnDiagPanel/g, "function enableExternalReturnDiagPanel_REMOVED"),
    },
    false,
    "missing_external_return_diag_api"
  );

  caseDelivery(
    "negative_missing_coordinated_scroll",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood
        .replace(/startExternalMainScrollRestoreCoordinated/g, "X")
        .replace(/bootRestoreExternalMainScrollAfterDocumentLoad/g, "Y"),
    },
    false,
    "missing_coordinated_scroll_restore"
  );

  caseDelivery(
    "negative_pinned_build",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood,
      options: { pinBuildId: OLD_BUILD },
    },
    false,
    "pinned_build_mismatch"
  );

  caseDelivery(
    "negative_runtime_boot_mismatch",
    {
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood,
      runtimeBootBuildId: OLD_BUILD,
    },
    false,
    "runtime_boot_build_mismatch"
  );

  must(aggregateReturnScenariosPass({ home: { pass: true }, menu: { pass: true }, mind: { pass: true } }), "agg:all_pass");
  must(!aggregateReturnScenariosPass({ home: { pass: true }, menu: { pass: false }, mind: { pass: true } }), "agg:menu_fail");
  must(!aggregateReturnScenariosPass({ home: { pass: true }, menu: { pass: true }, mind: { pass: false } }), "agg:mind_fail");
  must(
    evaluateExternalReturnProdDelivery({
      rootStatus: 200,
      rootHtml: htmlWithBuild(GOOD_BUILD),
      netJsStatus: 200,
      netJsText: netGood,
    }).pass,
    "positive:delivery_alone"
  );
  must(!aggregateReturnScenariosPass({ home: { pass: true }, menu: { pass: true }, mind: { pass: false } }), "agg:home_only_not_enough");

  const url = buildNetworkScriptUrl("https://infouzel.cz", "abc");
  must(url.includes("iu-network-connectivity-v1.js?v=abc"), "url:builder");

  console.log("IU_PWA_PROD_DELIVERY_SELFTEST_PASS=" + (fails.length === 0));
  if (fails.length) {
    console.log("IU_PWA_PROD_DELIVERY_SELFTEST_FAILS=" + fails.join(","));
    process.exitCode = 1;
  }
}

main();
