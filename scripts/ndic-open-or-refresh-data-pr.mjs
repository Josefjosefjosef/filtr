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
 *
 * Library mode (fixtures): export runOpenOrRefreshDataPr({ env, fetchImpl }).
 * Never falls back to gh CLI.
 */
export async function runOpenOrRefreshDataPr(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      rejectCode: "FETCH_UNAVAILABLE",
      detail: null,
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }

  const token = env.GH_TOKEN || env.GITHUB_TOKEN || "";
  const repo = env.GITHUB_REPOSITORY || "";
  const branch = env.AUTOMATION_BRANCH || "automation/update-ndic-datex-v1";
  const base = env.PR_BASE || "main";
  const title = env.PR_TITLE || "chore(data): refresh NDIC DATEX v1 snapshot";
  const body = env.PR_BODY || "Automated NDIC DATEX v1 data refresh.";

  if (!token) {
    return {
      ok: false,
      rejectCode: "MISSING_TOKEN",
      detail: null,
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }
  if (!repo || !repo.includes("/")) {
    return {
      ok: false,
      rejectCode: "MISSING_GITHUB_REPOSITORY",
      detail: null,
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }
  const [owner] = repo.split("/");
  if (!owner) {
    return {
      ok: false,
      rejectCode: "MISSING_OWNER",
      detail: null,
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }

  const api = "https://api.github.com";
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "iu-ndic-open-or-refresh-data-pr",
  };

  async function ghJson(method, path, payload) {
    const res = await fetchImpl(api + path, {
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
      json = { raw: String(text).slice(0, 200) };
    }
    return { res, json, text };
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
  if (!listed.res || listed.res.ok !== true) {
    const status = listed.res && listed.res.status != null ? listed.res.status : 0;
    return {
      ok: false,
      rejectCode: "LIST_PRS_FAILED",
      detail: { status, body: listed.json },
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }
  if (!Array.isArray(listed.json)) {
    return {
      ok: false,
      rejectCode: "MALFORMED_LIST_RESPONSE",
      detail: { status: listed.res.status, bodyType: typeof listed.json },
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }

  const open = listed.json;
  if (open.length > 0) {
    const pr = open[0];
    const number = pr && pr.number != null ? Number(pr.number) : NaN;
    if (!Number.isFinite(number) || number <= 0) {
      return {
        ok: false,
        rejectCode: "MALFORMED_EXISTING_PR",
        detail: { status: listed.res.status, body: pr || null },
        GH_CLI_REQUIRED: "NO",
        DATA_PR_OPEN_PORTABLE: "YES",
      };
    }
    // Deterministic refresh path: reuse first OPEN PR; never create a second.
    return {
      ok: true,
      action: "exists",
      number,
      url: (pr && pr.html_url) || null,
      openCount: open.length,
      createAttempted: false,
      DATA_PR_OPEN_PORTABLE: "YES",
      GH_CLI_REQUIRED: "NO",
      DATA_PR_DUPLICATE_PR_POSSIBLE: "NO",
    };
  }

  const created = await ghJson("POST", "/repos/" + repo + "/pulls", {
    title,
    head: branch,
    base,
    body,
    draft: false,
  });
  if (!created.res || created.res.ok !== true) {
    const status = created.res && created.res.status != null ? created.res.status : 0;
    return {
      ok: false,
      rejectCode: "CREATE_PR_FAILED",
      detail: { status, body: created.json },
      createAttempted: true,
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }
  const number =
    created.json && created.json.number != null ? Number(created.json.number) : NaN;
  if (!Number.isFinite(number) || number <= 0) {
    return {
      ok: false,
      rejectCode: "MALFORMED_CREATE_RESPONSE",
      detail: { status: created.res.status, body: created.json },
      createAttempted: true,
      GH_CLI_REQUIRED: "NO",
      DATA_PR_OPEN_PORTABLE: "YES",
    };
  }
  return {
    ok: true,
    action: "created",
    number,
    url: (created.json && created.json.html_url) || null,
    createAttempted: true,
    createHead: branch,
    createBase: base,
    DATA_PR_OPEN_PORTABLE: "YES",
    GH_CLI_REQUIRED: "NO",
    DATA_PR_DUPLICATE_PR_POSSIBLE: "NO",
  };
}

function isMain() {
  const entry = process.argv[1] ? String(process.argv[1]).replace(/\\/g, "/") : "";
  return entry.endsWith("/ndic-open-or-refresh-data-pr.mjs");
}

if (isMain()) {
  const result = await runOpenOrRefreshDataPr();
  if (!result.ok) {
    console.error(
      JSON.stringify({
        ok: false,
        rejectCode: result.rejectCode,
        detail: result.detail || null,
      })
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      action: result.action,
      number: result.number,
      url: result.url || null,
      DATA_PR_OPEN_PORTABLE: "YES",
      GH_CLI_REQUIRED: "NO",
    })
  );
}
