#!/usr/bin/env node
/**
 * P0 production root routing guard (HTTP + browser runtime).
 * Canonical app URL is https://infouzel.cz/ — never /projects/ as the hub.
 * Fail-fast on Cloudflare 429 / Error 1027 — no request storms.
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProdRequestBudget,
  isCloudflareQuotaResponse,
  quotaBlockerFailMessage,
} from "./guards/prod-request-budget.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const PROD_REQUEST_BUDGET = 12;

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
const prodBudget = createProdRequestBudget(PROD_REQUEST_BUDGET, "iu-root-routing-prod-guard");
let quotaBlocked = false;

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

function failQuota(step, status, bodySnippet) {
  quotaBlocked = true;
  ok(step, false, "quota:" + String(status));
  console.log(quotaBlockerFailMessage(step + ":" + status));
  if (bodySnippet && /Error\s+1027|plan limits/i.test(bodySnippet)) {
    console.log("CLOUDFLARE_ERROR_1027_DETECTED=true");
  }
}

const FETCH_TIMEOUT_MS = 30000;

async function fetchNoFollowOnce(url) {
  prodBudget.record(url);
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  let bodyText = "";
  if (isCloudflareQuotaResponse(res.status, "")) {
    try {
      bodyText = await res.text();
    } catch (_) {
      bodyText = "";
    }
  }
  if (isCloudflareQuotaResponse(res.status, bodyText)) {
    failQuota("cloudflare_quota", res.status, bodyText.slice(0, 200));
    return { status: res.status, location: "", quota: true };
  }
  return {
    status: res.status,
    location: res.headers.get("location") || "",
    cache: res.headers.get("cf-cache-status") || "",
    type: res.headers.get("content-type") || "",
    quota: false,
  };
}

async function fetchJsonOnce(url) {
  prodBudget.record(url);
  const res = await fetch(url, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch (_) {
    bodyText = "";
  }
  if (isCloudflareQuotaResponse(res.status, bodyText)) {
    failQuota("cloudflare_quota_manifest", res.status, bodyText.slice(0, 200));
    return { status: res.status, json: {}, quota: true };
  }
  let json = {};
  try {
    json = JSON.parse(bodyText);
  } catch (_) {
    json = {};
  }
  return { status: res.status, json, quota: false };
}


async function main() {
  const root = await fetchNoFollowOnce(PROD + "/");
  if (!quotaBlocked) {
    ok("root_200", root.status === 200, String(root.status));
    ok("root_no_location_projects", !/\/projects\//i.test(root.location), root.location);
  }

  if (!quotaBlocked) {
    const www = await fetchNoFollowOnce("https://www.infouzel.cz/");
    ok("www_3xx", www.status >= 301 && www.status < 400, String(www.status));
    ok(
      "www_to_apex",
      /^https:\/\/infouzel\.cz\/?(\?|$)/i.test(www.location) || www.location === "https://infouzel.cz/",
      www.location
    );
    ok("www_not_projects", !/\/projects\//i.test(www.location), www.location);
  }

  if (!quotaBlocked) {
    const projects = await fetchNoFollowOnce(PROD + "/projects/");
    ok("projects_permanent", projects.status === 301 || projects.status === 308, String(projects.status));
    ok("projects_to_root", /^https:\/\/infouzel\.cz\/?(\?|$)/i.test(projects.location), projects.location);
  }

  if (!quotaBlocked) {
    const projectsStat = await fetchNoFollowOnce(PROD + "/projects/statistiky/");
    ok("projects_stat_permanent", projectsStat.status === 301 || projectsStat.status === 308, String(projectsStat.status));
    ok(
      "projects_stat_to_root",
      /^https:\/\/infouzel\.cz\/statistiky\/?(\?|$)/i.test(projectsStat.location),
      projectsStat.location
    );
  }

  if (!quotaBlocked) {
    const projectsQ = await fetchNoFollowOnce(PROD + "/projects/?view=saved");
    ok("projects_query_permanent", projectsQ.status === 301 || projectsQ.status === 308, String(projectsQ.status));
    ok(
      "projects_query_kept",
      /view=saved/.test(projectsQ.location) && !/\/projects\//.test(new URL(projectsQ.location, PROD).pathname),
      projectsQ.location
    );
  }

  if (!quotaBlocked) {
    const data = await fetchNoFollowOnce(PROD + "/projects/version.json");
    ok("data_passthrough", data.status === 200, String(data.status));
  }

  if (!quotaBlocked) {
    const man = await fetchJsonOnce(PROD + "/manifest.json?cb=" + Date.now());
    const manJson = man.json || {};
    ok("manifest_200", man.status === 200, String(man.status));
    ok(
      "manifest_start",
      String(manJson.start_url || "") === "/" || String(manJson.start_url || "").startsWith("/?"),
      String(manJson.start_url)
    );
    ok("manifest_scope", String(manJson.scope || "") === "/", String(manJson.scope));
    ok("manifest_no_projects", !JSON.stringify(manJson).includes("/projects/"), "manifest");
  }

  const gitIndex = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("git_index_no_replace_projects", !/location\.(replace|assign)\([^)]*\/projects\//.test(gitIndex), "git_index");
  ok(
    "git_index_canonical_root",
    /canonical[^>]+https:\/\/infouzel\.cz\/["']/i.test(gitIndex) || /href="https:\/\/infouzel\.cz\/"/.test(gitIndex),
    "canonical"
  );

  if (chromium && !quotaBlocked) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = String(m.text() || "");
      if (/cloudflareinsights\.com\/beacon/i.test(t)) return;
      if (/Content Security Policy directive/i.test(t) && /cloudflareinsights/i.test(t)) return;
      if (/status of 429/i.test(t)) return;
      consoleErrors.push(t);
    });
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

    prodBudget.record(PROD + "/?browser=1");
    const resp = await page.goto(PROD + "/?cb=" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const st = resp ? resp.status() : 0;
    if (st === 429) {
      failQuota("browser_goto", st, "");
    } else {
      await page.waitForTimeout(2000);
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
          bodyLen: document.body && document.body.innerText ? document.body.innerText.trim().length : 0,
          hasApp: !!document.querySelector("#iuPrehledDneRoot, [data-iu-prehled-dne-root], #app, .iuAppShell, body.iu-app"),
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
      if (onlyCspHashMismatch && eventName === "pull_request" && localRepoCspInlineGuardClean()) {
        pending.push("csp_script_hash_mismatch_pending_deploy");
        report.cspHashMismatchConsole = consoleErrors.slice(0, 3);
      } else {
        ok("console_errors_zero", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
      }
      ok("page_errors_zero", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
    }
    await browser.close();
  } else if (!chromium) {
    ok("playwright", false, "missing");
  }

  report.prodRequestBudget = prodBudget.summary();

  const out = path.join(process.env.TEMP || "/tmp", "iu-root-routing-prod-guard-report.json");
  fs.writeFileSync(out, JSON.stringify({ fails, report, quotaBlocked }, null, 2));
  console.log("REPORT=" + out);
  console.log("PROD_SMOKE_REQUEST_BUDGET=" + PROD_REQUEST_BUDGET);
  console.log("ACTUAL_PROD_REQUESTS=" + prodBudget.count);
  if (quotaBlocked) {
    console.log("CLOUDFLARE_QUOTA_BLOCKER=true");
    console.log("HTTP_429_FAIL_FAST=PASS");
  }
  if (fails.length) {
    console.log("FAIL_COUNT=" + fails.length);
    for (const f of fails) console.log("FAIL " + f);
    process.exit(quotaBlocked ? 2 : 1);
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
