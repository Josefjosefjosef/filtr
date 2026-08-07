#!/usr/bin/env node
/**
 * Open or refresh the NDIC automation data PR without gh CLI.
 * Uses GitHub REST API via Node fetch (available on Node 24 runners).
 *
 * Env:
 *   GH_TOKEN / GITHUB_TOKEN — required
 *   GITHUB_REPOSITORY — owner/repo (required)
 *   AUTOMATION_BRANCH — head branch (default automation/update-ndic-datex-v1)
 *   PR_TITLE — optional
 *   PR_BODY — optional
 *   PR_BASE — default main
 */
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const repo = process.env.GITHUB_REPOSITORY || "";
const branch = process.env.AUTOMATION_BRANCH || "automation/update-ndic-datex-v1";
const base = process.env.PR_BASE || "main";
const title = process.env.PR_TITLE || "chore(data): refresh NDIC DATEX v1 snapshot";
const body =
  process.env.PR_BODY || "Automated NDIC DATEX v1 data refresh.";

function fail(code, detail) {
  console.error(JSON.stringify({ ok: false, rejectCode: code, detail: detail || null }));
  process.exit(1);
}

if (!token) fail("MISSING_TOKEN");
if (!repo || !repo.includes("/")) fail("MISSING_GITHUB_REPOSITORY");
const [owner] = repo.split("/");
if (!owner) fail("MISSING_OWNER");

const api = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: "Bearer " + token,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "iu-ndic-open-or-refresh-data-pr",
};

async function ghJson(method, path, payload) {
  const res = await fetch(api + path, {
    method,
    headers: payload
      ? { ...headers, "Content-Type": "application/json" }
      : headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text.slice(0, 200) };
  }
  return { res, json };
}

const head = owner + ":" + branch;
const listPath =
  "/repos/" +
  repo +
  "/pulls?state=open&head=" +
  encodeURIComponent(head) +
  "&base=" +
  encodeURIComponent(base) +
  "&per_page=5";

const listed = await ghJson("GET", listPath);
if (!listed.res.ok) {
  fail("LIST_PRS_FAILED", { status: listed.res.status, body: listed.json });
}
const open = Array.isArray(listed.json) ? listed.json : [];
if (open.length > 0) {
  const pr = open[0];
  console.log(
    JSON.stringify({
      ok: true,
      action: "exists",
      number: pr.number,
      url: pr.html_url || null,
      DATA_PR_OPEN_PORTABLE: "YES",
      GH_CLI_REQUIRED: "NO",
    })
  );
  process.exit(0);
}

const created = await ghJson("POST", "/repos/" + repo + "/pulls", {
  title,
  head: branch,
  base,
  body,
  draft: false,
});
if (!created.res.ok) {
  fail("CREATE_PR_FAILED", { status: created.res.status, body: created.json });
}
console.log(
  JSON.stringify({
    ok: true,
    action: "created",
    number: created.json && created.json.number,
    url: created.json && created.json.html_url,
    DATA_PR_OPEN_PORTABLE: "YES",
    GH_CLI_REQUIRED: "NO",
  })
);
