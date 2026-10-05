#!/usr/bin/env node
/**
 * P0 production root routing guard (HTTP + browser runtime).
 * Canonical app URL is https://infouzel.cz/ — never /projects/ as the hub.
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

let chromium;
try {
  chromium = require(path.join(ROOT, "node_modules", "playwright")).chromium;
} catch (_) {
  try {
    chromium = require("playwright").chromium;
  } catch (e) {
    chromium = null;
  }
}

const PROD = "https://infouzel.cz";
const fails = [];
const pending = [];
const report = { steps: [], at: new Date().toISOString() };

function isCspInlineHashMismatchError(msg) {
  const t = String(msg || "");
  return (
    /Executing inline script violates the following Content Security Policy directive/i.test(t) &&
    /Either the 'unsafe-inline' keyword, a hash \('sha256-/.test(t)
  );
}

function localRepoCspInlineGuardClean() {
  try {
    const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
    const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
    const scriptSrcMeta = (index.match(/script-src\s+([^;]+)/i) || [])[1] || "";
    const scriptSrcHeader = (headers.match(/script-src\s+([^;]+)/i) || [])[1] || "";
    if (/'unsafe-inline'/.test(scriptSrcMeta) || /'unsafe-inline'/.test(scriptSrcHeader)) return false;
    const re = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(index))) {
      const body = m[2];
      if (!body.trim()) continue;
      const hash = `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`;
      if (!scriptSrcMeta.includes(hash)) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function ok(id, cond, detail) {
  report.steps.push({ id, ok: !!cond, detail: detail || "" });
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res) {
  const raw = res.headers.get("retry-after");
  if (!raw) return 0;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec > 0) return Math.min(120000, sec * 1000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(120000, Math.max(0, when - Date.now()));
  return 0;
}

const FETCH_TIMEOUT_MS = 45000;

async function fetchNoFollow(url) {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 429 || attempt === maxAttempts - 1) {
      return {
        status: res.status,
        location: res.headers.get("location") || "",
        cache: res.headers.get("cf-cache-status") || "",
        type: res.headers.get("content-type") || "",
      };
    }
    const ra = retryAfterMs(res);
    const backoff = ra > 0 ? Math.min(45000, ra) : Math.min(15000, 2000 * (attempt + 1));
    await sleep(backoff);
  }
  return { status: 429, location: "", cache: "", type: "" };
}

async function prodPace() {
  await sleep(1500);
}

const RATE_LIMIT_CASCADE_IDS = new Set([
  "www_to_apex",
  "www_not_projects",
  "projects_to_root",
  "projects_stat_to_root",
  "projects_query_kept",
  "root_no_location_projects",
]);

function failuresAreRateLimitedOnly() {
  if (!fails.length) return false;
  const has429 = fails.some((f) => /:429$/.test(f) || /status of 429/i.test(f));
  if (!has429) return false;
  return fails.every((f) => {
    const id = f.split(":")[0];
    if (/:429$/.test(f) || /status of 429/i.test(f)) return true;
    return RATE_LIMIT_CASCADE_IDS.has(id);
  });
}

async function fetchJsonWithRetry(url) {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 429 || attempt === maxAttempts - 1) {
      const json = res.ok ? await res.json().catch(() => ({})) : {};
      return { status: res.status, json };
    }
    const ra = retryAfterMs(res);
    const backoff = ra > 0 ? Math.min(45000, ra) : Math.min(15000, 2000 * (attempt + 1));
    await sleep(backoff);
  }
  return { status: 429, json: {} };
}

async function runChecks() {
  fails.length = 0;
  report.steps = [];
  if (process.env.GITHUB_ACTIONS === "true") {
    await sleep(3000 + Math.floor(Math.random() * 7000));
  }

  const root = await fetchNoFollow(PROD + "/");
  ok("root_200", root.status === 200, String(root.status));
  ok("root_no_location_projects", !/\/projects\//i.test(root.location), root.location);

  await prodPace();
  const www = await fetchNoFollow("https://www.infouzel.cz/");
  ok("www_3xx", www.status >= 301 && www.status < 400, String(www.status));
  ok("www_to_apex", /^https:\/\/infouzel\.cz\/?(\?|$)/i.test(www.location) || www.location === "https://infouzel.cz/", www.location);
  ok("www_not_projects", !/\/projects\//i.test(www.location), www.location);

  await prodPace();
  const projects = await fetchNoFollow(PROD + "/projects/");
  ok("projects_permanent", projects.status === 301 || projects.status === 308, String(projects.status));
  ok("projects_to_root", /^https:\/\/infouzel\.cz\/?(\?|$)/i.test(projects.location), projects.location);

  await prodPace();
  const projectsStat = await fetchNoFollow(PROD + "/projects/statistiky/");
  ok("projects_stat_permanent", projectsStat.status === 301 || projectsStat.status === 308, String(projectsStat.status));
  ok("projects_stat_to_root", /^https:\/\/infouzel\.cz\/statistiky\/?(\?|$)/i.test(projectsStat.location), projectsStat.location);

  await prodPace();
  const projectsQ = await fetchNoFollow(PROD + "/projects/?view=saved");
  ok("projects_query_permanent", projectsQ.status === 301 || projectsQ.status === 308, String(projectsQ.status));
  ok("projects_query_kept", /view=saved/.test(projectsQ.location) && !/\/projects\//.test(new URL(projectsQ.location, PROD).pathname), projectsQ.location);

  await prodPace();
  const data = await fetchNoFollow(PROD + "/projects/version.json");
  ok("data_passthrough", data.status === 200, String(data.status));

  await prodPace();
  const man = await fetchJsonWithRetry(PROD + "/manifest.json?cb=" + Date.now());
  const manJson = man.json || {};
  ok("manifest_200", man.status === 200, String(man.status));
  ok("manifest_start", String(manJson.start_url || "") === "/" || String(manJson.start_url || "").startsWith("/?"), String(manJson.start_url));
  ok("manifest_scope", String(manJson.scope || "") === "/", String(manJson.scope));
  ok("manifest_no_projects", !JSON.stringify(manJson).includes("/projects/"), "manifest");

  // Repo static: git root index must never send users to /projects/
  const gitIndex = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("git_index_no_replace_projects", !/location\.(replace|assign)\([^)]*\/projects\//.test(gitIndex), "git_index");
  ok("git_index_canonical_root", /canonical[^>]+https:\/\/infouzel\.cz\/["']/i.test(gitIndex) || /href="https:\/\/infouzel\.cz\/"/.test(gitIndex), "canonical");

  if (chromium) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = String(m.text() || "");
      // Third-party CF beacon blocked by CSP is expected / not an app regression.
      if (/cloudflareinsights\.com\/beacon/i.test(t)) return;
      if (/Content Security Policy directive/i.test(t) && /cloudflareinsights/i.test(t)) return;
      consoleErrors.push(t);
    });
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

    let gotoOk = false;
    for (let attempt = 0; attempt < 5 && !gotoOk; attempt++) {
      const resp = await page.goto(PROD + "/?cb=" + Date.now(), {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const st = resp ? resp.status() : 0;
      if (st === 429) {
        await sleep(Math.min(20000, 4000 * (attempt + 1)));
        continue;
      }
      gotoOk = true;
    }
    await page.waitForTimeout(3500);
    const info = await page.evaluate(async () => {
      let sw = null;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        sw = reg
          ? {
              scope: reg.scope,
              active: reg.active && reg.active.scriptURL,
              controller: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL,
            }
          : null;
      } catch (e) {
        sw = { err: String(e) };
      }
      const canonical = document.querySelector('link[rel="canonical"]');
      const manifest = document.querySelector('link[rel="manifest"]');
      return {
        href: location.href,
        pathname: location.pathname,
        canonical: canonical && canonical.href,
        manifest: manifest && manifest.href,
        sw,
        bodyLen: (document.body && document.body.innerText ? document.body.innerText.trim().length : 0),
        hasApp: !!(document.querySelector("#iuPrehledDneRoot, [data-iu-prehled-dne-root], #app, .iuAppShell, body.iu-app")),
      };
    });
    report.browser = info;
    ok("browser_path_root", info.pathname === "/", info.pathname);
    ok("browser_href_no_projects", !String(info.href).includes("/projects/"), info.href);
    ok("browser_canonical", !String(info.canonical || "").includes("/projects/"), String(info.canonical || ""));
    ok("browser_manifest_link", !String(info.manifest || "").includes("/projects/"), String(info.manifest || ""));
    ok("browser_sw_scope", !info.sw || !String(info.sw.scope || "").includes("/projects/"), JSON.stringify(info.sw));
    ok("browser_body", info.bodyLen > 40 || info.hasApp, String(info.bodyLen));
    const eventName = String(process.env.GITHUB_EVENT_NAME || "");
    const onlyCspHashMismatch =
      consoleErrors.length > 0 && consoleErrors.every(isCspInlineHashMismatchError);
    if (
      onlyCspHashMismatch &&
      eventName === "pull_request" &&
      localRepoCspInlineGuardClean()
    ) {
      pending.push("csp_script_hash_mismatch_pending_deploy");
      report.cspHashMismatchConsole = consoleErrors.slice(0, 3);
    } else {
      ok("console_errors_zero", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
    }
    ok("page_errors_zero", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
    await browser.close();
  } else {
    ok("playwright", false, "missing");
  }
}

async function main() {
  await runChecks();
  if (fails.length && failuresAreRateLimitedOnly() && process.env.GITHUB_ACTIONS === "true") {
    report.rateLimitRetry = true;
    await sleep(45000);
    await runChecks();
  }

  const out = path.join(process.env.TEMP || "/tmp", "iu-root-routing-prod-guard-report.json");
  fs.writeFileSync(out, JSON.stringify({ fails, report }, null, 2));
  console.log("REPORT=" + out);
  if (fails.length) {
    console.log("FAIL_COUNT=" + fails.length);
    for (const f of fails) console.log("FAIL " + f);
    process.exit(1);
  }
  if (pending.length) {
    console.log("IU_ROOT_ROUTING_PROD_PENDING_DEPLOY=" + JSON.stringify(pending));
  }
  console.log("[iu-root-routing-prod-guard] OK");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(2);
});
