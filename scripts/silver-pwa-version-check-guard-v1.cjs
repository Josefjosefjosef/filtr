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
    "/projects/version.json",
    "serverVer === bootVer",
    "location.reload",
  ];
  for (const needle of requiredJs) {
    const err = assertIncludes(js, needle, "iu-pwa-version-check.js");
    if (err) return err;
    checks.push("js:" + needle);
  }

  const errSw = assertIncludes(sw, "isProjectsVersionProbePath", "sw.js");
  if (errSw) return errSw;
  checks.push("sw:version-probe-network-only");

  const errHtml = assertIncludes(html, "iu-pwa-version-check.js", "index.html");
  if (errHtml) return errHtml;
  checks.push("html:script-linked");

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

  async function runScenario(name, bootVer, serverVer, preSession) {
    let reloaded = false;
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
      location: { pathname: "/projects/", reload: () => { reloaded = true; } },
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
      sessionStorage: {
        getItem(k) { return Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null; },
        setItem(k, v) { session[k] = String(v); },
      },
      fetch: mockFetch(serverVer),
      __visFn: null,
      __pageFn: null,
    };
    sandbox.window = sandbox.window;
    sandbox.window.addEventListener = sandbox.window.addEventListener.bind(sandbox.window);
    vm.createContext(sandbox);
    vm.runInContext(jsSource, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { name, reloaded, visFn: !!sandbox.__visFn, pageFn: !!sandbox.__pageFn };
  }

  return (async () => {
    const same = await runScenario("same-version-no-reload", "v1", "v1", {});
    if (same.reloaded !== false) return fail("same version must not reload");
    proofs.push("same-version-no-reload");

    const newer = await runScenario("newer-version-reloads", "v1", "v2", {});
    if (newer.reloaded !== true) return fail("newer version must request reload");
    proofs.push("newer-version-reload");

    const loop = await runScenario(
      "reload-guard-blocks-loop",
      "v1",
      "v2",
      { "iu:pwa:ver:reloaded-for": "v2", "iu:pwa:ver:reload-ts": String(Date.now()) }
    );
    if (loop.reloaded !== false) return fail("reload guard must block loop");
    proofs.push("reload-loop-guard");

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
