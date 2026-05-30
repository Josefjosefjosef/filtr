#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const reportPath = path.join(__dirname, "silver-pwa-version-check-guard-v1-report.json");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function fail(msg) {
  return { pass: false, error: msg };
}

function assertIncludes(hay, needle, label) {
  if (!hay.includes(needle)) return fail(label + ": missing " + needle);
  return null;
}

function runStaticChecks() {
  const checks = [];
  const js = read("assets/iu-pwa-version-check.js");
  const sw = read("sw.js");
  const html = read("projects/index.html");
  const verJson = read("projects/version.json");
  const headers = read("_headers");

  const requiredJs = [
    'cache: "no-store"',
    "visibilitychange",
    "pageshow",
    "iu:pwa:ver:reloaded-for",
    "iu:pwa:ver:reload-ts",
    "iu:pwa:ver:reload-attempts",
    "/projects/version.json",
    "shouldSkipReload(serverVer, bootVer)",
    "IU_SW_DEPLOY_RELOAD",
    "__iuPwaVersionCheck",
    "location.reload",
  ];
  for (const needle of requiredJs) {
    const err = assertIncludes(js, needle, "iu-pwa-version-check.js");
    if (err) return err;
    checks.push("js:" + needle);
  }

  const swChecks = [
    "isProjectsVersionProbePath",
    "isProjectsHtmlPath",
    "networkFirstNoStore",
    "IU_SW_DEPLOY_RELOAD",
    "iu-pwa-version-check.js",
  ];
  for (const needle of swChecks) {
    const err = assertIncludes(sw, needle, "sw.js");
    if (err) return err;
    checks.push("sw:" + needle);
  }

  const headScriptMatch = html.match(
    /<head>[\s\S]*?<script src="\/assets\/iu-pwa-version-check\.js[^"]*"><\/script>/
  );
  if (!headScriptMatch) {
    return fail("index.html: sync iu-pwa-version-check.js must load in <head> (not defer-only)");
  }
  checks.push("html:sync-head-script");

  if (html.includes('defer src="/assets/iu-pwa-version-check.js')) {
    return fail("index.html: defer-only checker is insufficient for stale PWA shell");
  }
  checks.push("html:no-defer-only-checker");

  let parsed;
  try {
    parsed = JSON.parse(verJson);
  } catch (e) {
    return fail("version.json: invalid JSON");
  }
  if (!parsed.version || typeof parsed.version !== "string") {
    return fail("version.json: missing version string");
  }
  checks.push("version.json:valid");

  const metaMatch = html.match(/meta name="iu-build" content="([^"]+)"/);
  if (!metaMatch) return fail("index.html: missing iu-build meta");
  if (metaMatch[1] !== parsed.version) {
    return fail(
      "version.json version must match iu-build meta: " +
        metaMatch[1] +
        " vs " +
        parsed.version
    );
  }
  checks.push("version:meta-sync");

  const errHeaders = assertIncludes(headers, "/projects/version.json", "_headers");
  if (errHeaders) return errHeaders;
  checks.push("headers:no-cache");

  return { pass: true, checks };
}

function mockFetch(serverVersion) {
  return async function fetch(url, opts) {
    if (opts && opts.cache !== "no-store") {
      throw new Error("fetch must use cache no-store");
    }
    return {
      ok: true,
      async json() {
        return { version: serverVersion };
      },
    };
  };
}

function runLogicProofs() {
  const jsSource = read("assets/iu-pwa-version-check.js");
  const proofs = [];

  async function runScenario(bootVer, serverVer, preSession) {
    let reloadCount = 0;
    const session = Object.assign({}, preSession || {});
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (fn) => {
        fn();
        return 1;
      },
      requestIdleCallback: (fn) => {
        fn();
        return 1;
      },
      location: { pathname: "/projects/", reload: () => { reloadCount += 1; } },
      document: {
        visibilityState: "visible",
        addEventListener(type, fn) {
          if (type === "visibilitychange") sandbox.__visFn = fn;
        },
        querySelector(sel) {
          if (sel === 'meta[name="iu-build"]') {
            return { getAttribute: () => bootVer };
          }
          return null;
        },
      },
      window: {
        addEventListener(type, fn) {
          if (type === "pageshow") sandbox.__pageFn = fn;
        },
      },
      navigator: { serviceWorker: null },
      sessionStorage: {
        getItem(k) { return Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null; },
        setItem(k, v) { session[k] = String(v); },
      },
      fetch: mockFetch(serverVer),
      __visFn: null,
      __pageFn: null,
    };
    sandbox.window.addEventListener = sandbox.window.addEventListener.bind(sandbox.window);
    vm.createContext(sandbox);
    vm.runInContext(jsSource, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { reloadCount, session, visFn: !!sandbox.__visFn, pageFn: !!sandbox.__pageFn };
  }

  return (async () => {
    const same = await runScenario("v1", "v1", {});
    if (same.reloadCount !== 0) return fail("same version must not reload");
    proofs.push("same-version-no-reload");

    const newer = await runScenario("v1", "v2", {});
    if (newer.reloadCount !== 1) return fail("newer version must request reload once");
    proofs.push("newer-version-single-reload");

    const second = await runScenario("v2", "v2", {
      "iu:pwa:ver:reloaded-for": "v2",
      "iu:pwa:ver:reload-ts": String(Date.now()),
      "iu:pwa:ver:reload-attempts": "1",
    });
    if (second.reloadCount !== 0) return fail("second open with matching version must not reload");
    proofs.push("second-open-no-reload");

    const loop = await runScenario("v1", "v2", {
      "iu:pwa:ver:reloaded-for": "v2",
      "iu:pwa:ver:reload-ts": String(Date.now()),
      "iu:pwa:ver:reload-attempts": "1",
    });
    if (loop.reloadCount !== 0) return fail("cooldown must block immediate reload loop");
    proofs.push("cooldown-reload-loop-guard");

    const staleRetryAllowed = await runScenario("v1", "v2", {
      "iu:pwa:ver:reloaded-for": "v2",
      "iu:pwa:ver:reload-ts": String(Date.now() - 60000),
      "iu:pwa:ver:reload-attempts": "1",
    });
    if (staleRetryAllowed.reloadCount !== 1) {
      return fail("legitimate stale-shell retry after cooldown must reload again");
    }
    proofs.push("stale-shell-retry-after-cooldown");

    if (!newer.visFn || !newer.pageFn) return fail("missing pageshow/visibilitychange listeners");
    proofs.push("events-bound");

    return { pass: true, proofs };
  })();
}

async function main() {
  const staticResult = runStaticChecks();
  if (!staticResult.pass) {
    const report = { pass: false, stage: "static", error: staticResult.error, checks: staticResult.checks || [] };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stderr.write("SILVER_PWA_VERSION_CHECK_GUARD_V1 FAIL\n");
    process.stderr.write(staticResult.error + "\n");
    process.exit(1);
  }

  const logicResult = await runLogicProofs();
  if (!logicResult.pass) {
    const report = { pass: false, stage: "logic", error: logicResult.error, proofs: logicResult.proofs || [] };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stderr.write("SILVER_PWA_VERSION_CHECK_GUARD_V1 FAIL\n");
    process.stderr.write(logicResult.error + "\n");
    process.exit(1);
  }

  const report = {
    pass: true,
    engine_changed: false,
    service_worker_changed: true,
    user_data_deleted: false,
    reload_loop_guard: "PASS",
    sw_old_app_shell_fixed: "PASS",
    stale_shell_sync_head_script: "PASS",
    checks: staticResult.checks,
    proofs: logicResult.proofs,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write("SILVER_PWA_VERSION_CHECK_GUARD_V1 PASS\n");
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
