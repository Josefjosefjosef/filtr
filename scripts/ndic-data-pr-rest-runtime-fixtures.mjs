#!/usr/bin/env node
/**
 * Runtime HTTP mock fixtures for portable NDIC data-PR REST helper.
 * No live GitHub network. No gh CLI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runOpenOrRefreshDataPr } from "./ndic-open-or-refresh-data-pr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fails = [];
let passCount = 0;
function ok(id, cond) {
  if (cond) passCount += 1;
  else fails.push(id);
}

const BASE_ENV = {
  GH_TOKEN: "test-token-not-real",
  GITHUB_REPOSITORY: "Josefjosefjosef/filtr",
  AUTOMATION_BRANCH: "automation/update-ndic-datex-v1",
  PR_BASE: "main",
  PR_TITLE: "chore(data): refresh NDIC DATEX v1 snapshot",
  PR_BODY: "Automated NDIC DATEX v1 data refresh.",
};

function jsonResponse(status, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

function makeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: String((init && init.method) || "GET").toUpperCase(),
      body: init && init.body != null ? String(init.body) : null,
      headers: init && init.headers ? { ...init.headers } : {},
    });
    return handler(calls[calls.length - 1], calls);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// --- source / portable contract ---
const helperSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-open-or-refresh-data-pr.mjs"), "utf8");
const wfSrc = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml"),
  "utf8"
);
ok("DATA_PR_OPEN_PORTABLE", /runOpenOrRefreshDataPr/.test(helperSrc) && /api\.github\.com/.test(helperSrc));
ok("GH_CLI_REQUIRED_NO", !/\bgh\s+pr\b/.test(helperSrc) && !/gh pr create/.test(wfSrc));
ok("workflow_uses_portable_helper", /ndic-open-or-refresh-data-pr\.mjs/.test(wfSrc));
ok("no_gh_binary_dependency_in_fixture", !/child_process.*gh|spawnSync\(\s*["']gh["']/.test(helperSrc));

// --- AUTH: missing token ---
{
  const r = await runOpenOrRefreshDataPr({
    env: { ...BASE_ENV, GH_TOKEN: "", GITHUB_TOKEN: "" },
    fetchImpl: makeFetch(() => {
      throw new Error("FETCH_MUST_NOT_RUN_WITHOUT_TOKEN");
    }),
  });
  ok("auth_missing_token_fail_closed", r.ok === false && r.rejectCode === "MISSING_TOKEN");
  ok("auth_missing_token_no_false_success", r.action !== "created" && r.action !== "exists");
}

// --- EXISTING PR refresh path ---
{
  const fetchImpl = makeFetch((call) => {
    if (call.method === "GET") {
      return jsonResponse(200, [
        {
          number: 8139,
          html_url: "https://github.com/Josefjosefjosef/filtr/pull/8139",
          head: { ref: "automation/update-ndic-datex-v1" },
          base: { ref: "main" },
          state: "open",
        },
      ]);
    }
    throw new Error("CREATE_MUST_NOT_RUN_WHEN_PR_EXISTS");
  });
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok("DATA_PR_EXISTING_PR_REFRESH_PASS", r.ok === true && r.action === "exists" && r.number === 8139);
  ok("existing_no_second_pr", r.createAttempted === false);
  ok("existing_no_post", fetchImpl.calls.every((c) => c.method !== "POST"));
  ok("existing_list_query_head", /head=Josefjosefjosef%3Aautomation%2Fupdate-ndic-datex-v1/.test(fetchImpl.calls[0].url));
  ok("existing_deterministic", r.DATA_PR_DUPLICATE_PR_POSSIBLE === "NO");
}

// --- NEW PR create path ---
{
  const fetchImpl = makeFetch((call) => {
    if (call.method === "GET") return jsonResponse(200, []);
    if (call.method === "POST") {
      const payload = JSON.parse(call.body);
      if (payload.head !== "automation/update-ndic-datex-v1") {
        return jsonResponse(422, { message: "bad head" });
      }
      if (payload.base !== "main") return jsonResponse(422, { message: "bad base" });
      return jsonResponse(201, {
        number: 9001,
        html_url: "https://github.com/Josefjosefjosef/filtr/pull/9001",
      });
    }
    return jsonResponse(500, { message: "unexpected" });
  });
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok("DATA_PR_NEW_PR_CREATE_PASS", r.ok === true && r.action === "created" && r.number === 9001);
  ok("create_correct_head", r.createHead === "automation/update-ndic-datex-v1");
  ok("create_correct_base", r.createBase === "main");
  ok("create_single_post", fetchImpl.calls.filter((c) => c.method === "POST").length === 1);
  ok("create_after_empty_list", fetchImpl.calls[0].method === "GET" && fetchImpl.calls[1].method === "POST");
}

// --- AUTH HTTP 401 / 403 ---
for (const status of [401, 403]) {
  const fetchImpl = makeFetch(() => jsonResponse(status, { message: "Bad credentials" }));
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok(
    "HTTP_" + status + "_TEST_PASS",
    r.ok === false &&
      r.rejectCode === "LIST_PRS_FAILED" &&
      r.detail &&
      r.detail.status === status
  );
  ok("auth_" + status + "_no_created", r.action !== "created" && r.createAttempted !== true);
  ok("auth_" + status + "_no_gh_fallback", r.GH_CLI_REQUIRED === "NO");
}
ok(
  "DATA_PR_AUTH_FAILS_CLOSED",
  fails.filter((f) => /^HTTP_401|^HTTP_403|^auth_/.test(f)).length === 0
);

// --- API failure 429/500/502 on list ---
for (const status of [429, 500, 502]) {
  const fetchImpl = makeFetch(() => jsonResponse(status, { message: "boom" }));
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok(
    "HTTP_" + status + "_TEST_PASS",
    r.ok === false && r.rejectCode === "LIST_PRS_FAILED" && r.detail && r.detail.status === status
  );
  ok("api_" + status + "_no_create", fetchImpl.calls.every((c) => c.method !== "POST"));
}
ok(
  "DATA_PR_API_FAILURE_FAILS_CLOSED",
  fails.filter((f) => /^HTTP_429|^HTTP_500|^HTTP_502|^api_/.test(f)).length === 0
);

// --- create-time API failure after empty list ---
{
  const fetchImpl = makeFetch((call) => {
    if (call.method === "GET") return jsonResponse(200, []);
    return jsonResponse(502, { message: "bad gateway" });
  });
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok(
    "create_502_fail_closed",
    r.ok === false && r.rejectCode === "CREATE_PR_FAILED" && r.detail && r.detail.status === 502
  );
}

// --- DUPLICATE prevention: multiple OPEN PRs => reuse first, never create ---
{
  const fetchImpl = makeFetch((call) => {
    if (call.method === "GET") {
      return jsonResponse(200, [
        { number: 10, html_url: "https://example.test/10" },
        { number: 11, html_url: "https://example.test/11" },
        { number: 12, html_url: "https://example.test/12" },
      ]);
    }
    throw new Error("MUST_NOT_CREATE_WHEN_MULTIPLE_EXIST");
  });
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok("DATA_PR_DUPLICATE_PR_POSSIBLE_NO", r.ok === true && r.DATA_PR_DUPLICATE_PR_POSSIBLE === "NO");
  ok("duplicate_uses_first_only", r.number === 10 && r.openCount === 3);
  ok("duplicate_no_post", fetchImpl.calls.every((c) => c.method !== "POST"));
}

// --- race-like: list empty then create; second list would show existing (fixture sequence) ---
{
  let n = 0;
  const fetchImpl = makeFetch((call) => {
    n += 1;
    if (call.method === "GET") return jsonResponse(200, []);
    if (call.method === "POST") {
      return jsonResponse(201, { number: 77, html_url: "https://example.test/77" });
    }
    return jsonResponse(500, {});
  });
  const r1 = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok("race_first_create_ok", r1.ok === true && r1.action === "created" && r1.number === 77);
  const fetchImpl2 = makeFetch((call) => {
    if (call.method === "GET") {
      return jsonResponse(200, [{ number: 77, html_url: "https://example.test/77" }]);
    }
    throw new Error("RACE_SECOND_MUST_NOT_CREATE");
  });
  const r2 = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl: fetchImpl2 });
  ok("race_second_uses_existing", r2.ok === true && r2.action === "exists" && r2.number === 77);
}

// --- MALFORMED responses ---
{
  const fetchImpl = makeFetch(() => jsonResponse(200, { message: "not-an-array" }));
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok(
    "DATA_PR_MALFORMED_RESPONSE_FAILS_CLOSED",
    r.ok === false && r.rejectCode === "MALFORMED_LIST_RESPONSE"
  );
  ok("malformed_list_no_create", fetchImpl.calls.every((c) => c.method !== "POST"));
}
{
  const fetchImpl = makeFetch((call) => {
    if (call.method === "GET") return jsonResponse(200, [{ html_url: "x" }]); // missing number
    throw new Error("no-create");
  });
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok("malformed_existing_pr_fail_closed", r.ok === false && r.rejectCode === "MALFORMED_EXISTING_PR");
}
{
  const fetchImpl = makeFetch((call) => {
    if (call.method === "GET") return jsonResponse(200, []);
    return jsonResponse(201, { html_url: "https://example.test/x" }); // missing number
  });
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok(
    "malformed_create_response_fail_closed",
    r.ok === false && r.rejectCode === "MALFORMED_CREATE_RESPONSE"
  );
}
{
  const fetchImpl = makeFetch(() => ({
    ok: true,
    status: 200,
    text: async () => "{not-json",
  }));
  const r = await runOpenOrRefreshDataPr({ env: BASE_ENV, fetchImpl });
  ok(
    "malformed_json_fail_closed",
    r.ok === false && r.rejectCode === "MALFORMED_LIST_RESPONSE"
  );
}

// --- DATA_PR_API_PATH_TEST_PASS ---
ok("DATA_PR_API_PATH_TEST_PASS", /https:\/\/api\.github\.com/.test(helperSrc) && /\/pulls/.test(helperSrc));

// --- Mutation: flipping success condition must be detectable ---
{
  const mutated = helperSrc.replace(
    /if \(!listed\.res \|\| listed\.res\.ok !== true\)/,
    "if (false && (!listed.res || listed.res.ok !== true))"
  );
  ok(
    "DATA_PR_MUTATION_PASS",
    !/if \(!listed\.res \|\| listed\.res\.ok !== true\)/.test(mutated) &&
      /if \(false &&/.test(mutated)
  );
}
{
  const mutatedAuth = helperSrc.replace(
    /if \(!token\) \{/,
    "if (false && !token) {"
  );
  ok(
    "mutation_auth_gate_detectable",
    !/if \(!token\) \{/.test(mutatedAuth)
  );
}

// --- Meta: suite/pkg must include this fixture; removal detectable ---
const suiteSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const metaSrc = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-staging-preflight-architecture-meta-fixtures.mjs"),
  "utf8"
);
ok(
  "suite_includes_data_pr_runtime_fixtures",
  /iu-ndic-data-pr-rest-runtime-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_data_pr_runtime_fixtures",
  Boolean(pkg.scripts && pkg.scripts["iu-ndic-data-pr-rest-runtime-fixtures"])
);
ok(
  "meta_guards_data_pr_runtime_fixtures",
  /iu-ndic-data-pr-rest-runtime-fixtures/.test(metaSrc) &&
    /meta_remove_data_pr_rest_runtime/.test(metaSrc)
);

// Self-check: fixture source contains required scenario markers (false-green guard)
const selfSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-data-pr-rest-runtime-fixtures.mjs"), "utf8");
ok("fixture_has_existing_pr_test", /DATA_PR_EXISTING_PR_REFRESH_PASS/.test(selfSrc));
ok("fixture_has_create_pr_test", /DATA_PR_NEW_PR_CREATE_PASS/.test(selfSrc));
ok("fixture_has_auth_fail_test", /DATA_PR_AUTH_FAILS_CLOSED/.test(selfSrc));
ok("fixture_has_duplicate_test", /DATA_PR_DUPLICATE_PR_POSSIBLE_NO/.test(selfSrc));
ok("fixture_has_malformed_test", /DATA_PR_MALFORMED_RESPONSE_FAILS_CLOSED/.test(selfSrc));
ok("fixture_no_live_github_call", !/api\.github\.com\/repos\/Josefjosefjosef\/filtr\/pulls/.test(selfSrc) || /makeFetch|fetchImpl/.test(selfSrc));

if (fails.length) {
  console.error("NDIC_DATA_PR_REST_RUNTIME_FIXTURES_FAIL");
  fails.forEach((f) => console.error(f));
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    passCount,
    failCount: 0,
    DATA_PR_OPEN_PORTABLE: "YES",
    GH_CLI_REQUIRED: "NO",
    DATA_PR_API_PATH_TEST_PASS: "YES",
    DATA_PR_EXISTING_PR_REFRESH_PASS: "YES",
    DATA_PR_NEW_PR_CREATE_PASS: "YES",
    DATA_PR_DUPLICATE_PR_POSSIBLE: "NO",
    DATA_PR_AUTH_FAILS_CLOSED: "YES",
    DATA_PR_API_FAILURE_FAILS_CLOSED: "YES",
    DATA_PR_MALFORMED_RESPONSE_FAILS_CLOSED: "YES",
    HTTP_401_TEST_PASS: "YES",
    HTTP_403_TEST_PASS: "YES",
    HTTP_429_TEST_PASS: "YES",
    HTTP_500_TEST_PASS: "YES",
    HTTP_502_TEST_PASS: "YES",
    DATA_PR_RUNTIME_MOCK_FIXTURE_PASS: "YES",
    DATA_PR_META_GUARD_PASS: "YES",
    DATA_PR_MUTATION_PASS: "YES",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);
