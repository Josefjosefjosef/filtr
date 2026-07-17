#!/usr/bin/env node
/**
 * Safe production version.json probe — never throws on short/empty bodies.
 * Does NOT decide GREEN/RED of a release by itself; prints DIAG_* statuses.
 *
 * Run: npm run iu-prod-version-json-safe-probe
 * Env: IU_PROD_BASE (default https://infouzel.cz)
 */
import https from "https";
import http from "http";

const BASE = String(process.env.IU_PROD_BASE || "https://infouzel.cz").replace(/\/$/, "");

function preview(s, maxLen) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const n = Math.min(Math.max(0, maxLen | 0), t.length);
  return t.slice(0, n);
}

function fetchText(url) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      const req = lib.get(
        url,
        { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }, timeout: 20000 },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode || 0,
              text: text == null ? "" : String(text),
            });
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, status: 0, text: "", error: "timeout" });
      });
      req.on("error", (e) => {
        resolve({ ok: false, status: 0, text: "", error: String(e && e.message ? e.message : e) });
      });
    } catch (e) {
      resolve({ ok: false, status: 0, text: "", error: String(e && e.message ? e.message : e) });
    }
  });
}

async function main() {
  const url = `${BASE}/projects/version.json`;
  const r = await fetchText(url);
  const len = r.text.length;
  console.log(`DIAG_URL=${url}`);
  console.log(`DIAG_HTTP_OK=${r.ok ? "YES" : "NO"}`);
  console.log(`DIAG_HTTP_STATUS=${r.status}`);
  console.log(`DIAG_BODY_LEN=${len}`);
  if (r.error) console.log(`DIAG_FETCH_ERROR=${r.error}`);

  if (!r.ok || len === 0) {
    console.log("DIAG_PARSE=SKIP_EMPTY_OR_HTTP_FAIL");
    console.log("DIAG_VERSION=");
    console.log("DIAG_BUILT_AT=");
    console.log("DIAG_PREVIEW=");
    console.log("DIAG_VERDICT=UNVERIFIED");
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(r.text);
  } catch (e) {
    console.log(`DIAG_PARSE=FAIL_JSON:${String(e && e.message ? e.message : e)}`);
    console.log(`DIAG_PREVIEW=${preview(r.text, 120)}`);
    console.log("DIAG_VERSION=");
    console.log("DIAG_BUILT_AT=");
    console.log("DIAG_VERDICT=UNVERIFIED");
    return;
  }

  const version = parsed && typeof parsed.version === "string" ? parsed.version : "";
  const builtAt = parsed && typeof parsed.builtAt === "string" ? parsed.builtAt : "";
  console.log("DIAG_PARSE=OK");
  console.log(`DIAG_VERSION=${version}`);
  console.log(`DIAG_BUILT_AT=${builtAt}`);
  console.log(`DIAG_PREVIEW=${preview(r.text, 120)}`);
  console.log("DIAG_VERDICT=PARSED_OK_NOT_A_RELEASE_GATE");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("DIAG_FATAL=" + String(e && e.message ? e.message : e));
    console.log("DIAG_VERDICT=UNVERIFIED");
    process.exit(0);
  });
