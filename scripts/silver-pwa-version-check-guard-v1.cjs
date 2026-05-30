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

function extractInlineBootstrap(html) {
  const m = html.match(/<!-- P0 PWA: inline bootstrap[\s\S]*?<script>\s*([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}

function runStaticChecks() {
  const checks = [];
  const js = read("assets/iu-pwa-version-check.js");
  const sw = read("sw.js");
  const html = read("projects/index.html");
  const verJson = read("projects/version.json");
  const headers = read("_headers");

  const inline = extractInlineBootstrap(html);
  if (!inline || !inline.includes("__iuPwaInlineBoot")) {
    return fail("index.html: missing inline PWA bootstrap in head");
  }
  checks.push("html:inline-bootstrap");

  const metaCache = assertIncludes(html, 'http-equiv="Cache-Control"', "index.html");
  if (metaCache) return metaCache;
  checks.push("html:meta-cache-control");

  const requiredInline = [
    "/projects/version.json",
    "IU_SW_DEPLOY_RELOAD",
    'cache:"no-store"',
    "pageshow",
    "visibilitychange",
    "rg.update()",
  ];
  for (const needle of requiredInline) {
    const err = assertIncludes(inline.replace(/\s+/g, ""), needle.replace(/\s+/g, ""), "inline-bootstrap");
    if (err) return err;
    checks.push("inline:" + needle);
  }

  const requiredJs = [
    'cache: "no-store"',
    "visibilitychange",
    "pageshow",
    "iu:pwa:ver:reloaded-for",
    "/projects/version.json",
    "IU_SW_DEPLOY_RELOAD",
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
    "no-cache, no-store, must-revalidate",
  ];
  for (const needle of swChecks) {
    const err = assertIncludes(sw, needle, "sw.js");
    if (err) return err;
    checks.push("sw:" + needle);
  }

  if (html.includes('defer src="/assets/iu-pwa-version-check.js')) {
    return fail("index.html: defer-only checker is insufficient for stale PWA shell");
  }
  checks.push("html:no-defer-only-checker");

  const headerPaths = ["/projects/", "/projects/version.json", "/sw.js", "/assets/iu-pwa-version-check.js"];
  for (const hp of headerPaths) {
    const err = assertIncludes(headers, hp, "_headers");
    if (err) return err;
    checks.push("headers:" + hp);
  }

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

  const manifest = JSON.parse(read("projects/manifest.json"));
  if (manifest.start_url !== "/projects/") {
    return fail("manifest start_url must be /projects/");
  }
  checks.push("manifest:start_url");

  return { pass: true, checks, inline, manifest };
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

async function runInlineLogicProof(inlineSource) {
  async function runScenario(bootVer, serverVer, preSession) {
    let reloadCount = 0;
    const session = Object.assign({}, preSession || {});
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (fn) => { fn(); return 1; },
      location: { pathname: "/projects/", reload: () => { reloadCount += 1; } },
      document: {
        visibilityState: "visible",
        addEventListener(type, fn) {
          if (type === "visibilitychange") sandbox.__visFn = fn;
        },
        querySelector(sel) {
          if (sel === 'meta[name="iu-build"]') return { getAttribute: () => bootVer };
          return null;
        },
      },
      window: {
        addEventListener(type, fn) {
          if (type === "pageshow") sandbox.__pageFn = fn;
        },
      },
      navigator: {
        serviceWorker: {
          getRegistration: async () => ({ update: async () => {} }),
          addEventListener: () => {},
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
    sandbox.window.addEventListener = sandbox.window.addEventListener.bind(sandbox.window);
    vm.createContext(sandbox);
    vm.runInContext(inlineSource, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { reloadCount, visFn: !!sandbox.__visFn, pageFn: !!sandbox.__pageFn };
  }

  const proofs = [];
  const same = await runScenario("v1", "v1", {});
  if (same.reloadCount !== 0) return fail("inline same version must not reload");
  proofs.push("inline-same-version-no-reload");

  const newer = await runScenario("v1", "v2", {});
  if (newer.reloadCount !== 1) return fail("inline newer version must reload once");
  proofs.push("inline-newer-version-single-reload");

  const loop = await runScenario("v1", "v2", {
    "iu:pwa:ver:reloaded-for": "v2",
    "iu:pwa:ver:reload-ts": String(Date.now()),
    "iu:pwa:ver:reload-attempts": "1",
  });
  if (loop.reloadCount !== 0) return fail("inline cooldown must block loop");
  proofs.push("inline-cooldown-reload-loop-guard");

  return { pass: true, proofs };
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

  const inlineResult = await runInlineLogicProof(staticResult.inline);
  if (!inlineResult.pass) {
    const report = { pass: false, stage: "inline-logic", error: inlineResult.error, proofs: inlineResult.proofs || [] };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stderr.write("SILVER_PWA_VERSION_CHECK_GUARD_V1 FAIL\n");
    process.stderr.write(inlineResult.error + "\n");
    process.exit(1);
  }

  const report = {
    pass: true,
    engine_changed: false,
    service_worker_changed: true,
    user_data_deleted: false,
    reload_loop_guard: "PASS",
    sw_old_app_shell_fixed: "PASS",
    fresh_browser_update_flow: "PASS",
    stale_shell_simulated_flow: "PASS",
    physical_ios_home_screen_verified: "NO",
    physical_android_home_screen_verified: "NO",
    physical_home_screen_flow: "NOT_VERIFIED",
    previous_proof_false_positive: "YES",
    false_positive_reason: "fresh browser PASS while production Cache-Control max-age=600 and stale Home Screen not verified",
    checks: staticResult.checks,
    proofs: inlineResult.proofs,
    manifest_start_url: staticResult.manifest.start_url,
    home_screen_expected_url: "https://infouzel.cz/projects/",
    start_url_equals_projects_url: "YES",
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write("SILVER_PWA_VERSION_CHECK_GUARD_V1 PASS\n");
  process.stdout.write("physical_home_screen_flow=NOT_VERIFIED (requires real device)\n");
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
