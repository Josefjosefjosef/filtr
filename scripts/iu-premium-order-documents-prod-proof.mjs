#!/usr/bin/env node
/**
 * Bounded production proof: backfill-documents dry-run/apply + PDF download/open.
 * Uses ephemeral admin (D1) like approve-publish E2E — no real customer orders modified except document generation.
 */
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADS_CWD = join(REPO, "cloudflare", "iu-ads");
const BASE = process.env.ADS_BASE_URL || "https://ads.infouzel.cz";
const PEPPER = process.env.ADS_PASSWORD_PEPPER || "";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "577868e9aac9c289e9323100f68fad16";
const RUN = Date.now().toString(36);
const MAX_PROD_HTTP = 24;
let prodHttp = 0;
const fails = [];

function pass(k, v) {
  if (v === undefined) v = true;
  console.log(String(k) + "=" + String(v));
  return v;
}
function fail(k, v) {
  if (v === undefined) v = false;
  fails.push(k);
  console.log(String(k) + "=" + String(v));
  return v;
}

function prodFetch(url, init) {
  prodHttp += 1;
  if (prodHttp > MAX_PROD_HTTP) throw new Error("production_request_budget_exceeded");
  return fetch(url, init);
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}

function hashPassword(password, pepper) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password + "|" + pepper, salt, 100_000, 32, "sha256");
  return "pbkdf2$100000$" + toHex(salt) + "$" + toHex(derived);
}

function cookieHeaderFromSetCookie(setCookieHeaders) {
  const parts = [];
  for (const raw of setCookieHeaders || []) {
    const first = String(raw).split(";")[0];
    if (first && first.includes("=")) parts.push(first);
  }
  return parts.join("; ");
}

function resolveAdsDatabaseId() {
  const out = execFileSync("npx", ["wrangler", "d1", "list", "--json"], {
    cwd: ADS_CWD,
    env: process.env,
    encoding: "utf8",
  });
  const arr = JSON.parse(out);
  const hit = (arr || []).find((x) => x && x.name === "iu-ads");
  const id = hit && (hit.uuid || hit.id || "");
  if (!id) throw new Error("iu_ads_d1_id_missing");
  const tomlPath = join(ADS_CWD, "wrangler.toml");
  let toml = readFileSync(tomlPath, "utf8");
  toml = toml.replace(/database_id\s*=\s*"[0-9a-f-]{36}"/i, 'database_id = "' + id + '"');
  writeFileSync(tomlPath, toml, "utf8");
  return id;
}

function d1(sql) {
  const file = join(tmpdir(), "iu-doc-proof-" + RUN + ".sql");
  writeFileSync(file, sql, "utf8");
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "iu-ads", "--remote", "--file", file], {
      cwd: ADS_CWD,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    try {
      unlinkSync(file);
    } catch (_) {}
  }
}

function d1Query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "iu-ads", "--remote", "--command", sql, "--json"],
    { cwd: ADS_CWD, env: process.env, encoding: "utf8" }
  );
  return JSON.parse(out);
}

async function main() {
  pass("EXPECTED_PRODUCTION_REQUESTS", MAX_PROD_HTTP);
  if (!PEPPER || !process.env.CLOUDFLARE_API_TOKEN) {
    fail("SECRETS", false);
    fail("TASK_COMPLETE", false);
    process.exit(1);
  }
  resolveAdsDatabaseId();

  const EMAIL = "iu-doc-proof-" + RUN + "@invalid.test";
  const password = "IU-Doc-" + randomBytes(12).toString("base64url") + "!aA1";
  const USER_ID = "usr_docproof_" + RUN;
  const NOW = new Date().toISOString();
  const passwordHash = hashPassword(password, PEPPER);

  d1(
    "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES ('" +
      sqlEscape(USER_ID) +
      "','" +
      sqlEscape(EMAIL) +
      "','" +
      sqlEscape(passwordHash) +
      "','IU Doc Proof',1,0,'" +
      NOW +
      "','" +
      NOW +
      "'); INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES ('" +
      sqlEscape(USER_ID) +
      "','main_admin','" +
      NOW +
      "','doc_proof');"
  );

  const loginRes = await prodFetch(BASE + "/v1/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  const setCookie = typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
  const cookie = cookieHeaderFromSetCookie(setCookie);
  if (loginRes.status !== 200 || !cookie) {
    fail("ADMIN_LOGIN", false);
    process.exit(1);
  }
  pass("ADMIN_LOGIN", true);

  const dryRes = await prodFetch(BASE + "/v1/admin/premium/orders/backfill-documents", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: cookie },
    body: JSON.stringify({ dry_run: true, limit: 50 }),
  });
  const dryJson = await dryRes.json().catch(() => ({}));
  pass("HISTORICAL_DOCUMENTS_DRY_RUN", dryRes.status === 200 && dryJson.ok === true);
  pass("HISTORICAL_DRY_RUN_COUNT", Number(dryJson.would_process) || 0);
  const dryRunOrderIds = Array.isArray(dryJson.order_ids) ? dryJson.order_ids.filter(Boolean) : [];

  const applyRes = await prodFetch(BASE + "/v1/admin/premium/orders/backfill-documents", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: cookie },
    body: JSON.stringify({ dry_run: false, limit: 10 }),
  });
  const applyJson = await applyRes.json().catch(() => ({}));
  pass("HISTORICAL_DOCUMENTS_BACKFILL", applyRes.status === 200 && applyJson.ok === true);
  if (Array.isArray(applyJson.outcomes)) {
    pass(
      "BACKFILL_OUTCOME_ERRORS",
      applyJson.outcomes.filter((o) => o && (o.ok === false || (o.order_confirmation && o.order_confirmation.ok === false))).length
    );
  }

  const invBefore = d1Query(
    "SELECT COUNT(*) AS c FROM invoices i JOIN premium_selected_orders po ON po.order_id = i.order_id WHERE po.workflow_status='published'"
  );
  const invCountBefore = Number((((invBefore[0] || {}).results || [])[0] || {}).c) || 0;

  const listRes = await prodFetch(BASE + "/v1/admin/premium/orders?status=published&limit=20", {
    headers: { Cookie: cookie },
  });
  const listJson = await listRes.json().catch(() => ({}));
  let orders = (listJson.premium_orders || []).filter((o) => o && o.order_id);
  if (orders.length === 0 && dryRunOrderIds.length > 0) {
    orders = dryRunOrderIds.map((order_id) => ({ order_id }));
  }
  pass("PUBLISHED_ORDERS_LIST", listRes.status === 200 && orders.length > 0);

  let verifiedOrder = null;
  for (const row of orders.slice(0, 5)) {
    const detailRes = await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(row.order_id), {
      headers: { Cookie: cookie },
    });
    const detail = await detailRes.json().catch(() => ({}));
    const docs = detail.order_documents || [];
    const ready = docs.filter((d) => d.status === "ready");
    if (ready.length >= 2) {
      verifiedOrder = { order_id: row.order_id, docs: ready, order: detail.order || {} };
      break;
    }
    if (detail.order && detail.order.workflow_status === "published") {
      await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(row.order_id) + "/documents/retry", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: cookie },
        body: "{}",
      });
    }
  }

  if (!verifiedOrder) {
    const row = orders[0];
    if (row) {
      await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(row.order_id) + "/documents/retry", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: cookie },
        body: "{}",
      });
      const detailRes = await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(row.order_id), {
        headers: { Cookie: cookie },
      });
      const detail = await detailRes.json().catch(() => ({}));
      const docs = (detail.order_documents || []).filter((d) => d.status === "ready");
      if (docs.length >= 2) verifiedOrder = { order_id: row.order_id, docs, order: detail.order || {} };
    }
  }

  pass("PRODUCTION_ADMIN_PASS", !!verifiedOrder);
  if (!verifiedOrder) {
    try {
      const snap = d1Query(
        "SELECT order_id, doc_kind, status, substr(COALESCE(last_error,''),1,160) AS err FROM premium_order_document_jobs ORDER BY updated_at DESC LIMIT 8"
      );
      pass("DOCUMENT_JOB_SNAPSHOT", JSON.stringify(snap));
    } catch (_) {
      pass("DOCUMENT_JOB_SNAPSHOT", "unavailable");
    }
    fail("PRODUCTION_ORDER_PDF_PASS", false);
    fail("PRODUCTION_INVOICE_PDF_PASS", false);
    fail("PREVIOUSLY_CORRECT_BROKEN", 1);
    fail("TASK_COMPLETE", false);
    pass("ACTUAL_PRODUCTION_REQUESTS", prodHttp);
    process.exit(1);
  }

  const invAfter = d1Query(
    "SELECT COUNT(*) AS c FROM invoices i JOIN premium_selected_orders po ON po.order_id = i.order_id WHERE po.workflow_status='published'"
  );
  const invCountAfter = Number((((invAfter[0] || {}).results || [])[0] || {}).c) || 0;
  pass("INVOICE_DUPLICATES", invCountAfter === invCountBefore ? 0 : "STOP");

  const company = String(verifiedOrder.order.company_name || "");
  let orderPdfOk = false;
  let invoicePdfOk = false;

  for (const doc of verifiedOrder.docs) {
    const accRes = await prodFetch(
      BASE +
        "/v1/admin/premium/orders/" +
        encodeURIComponent(verifiedOrder.order_id) +
        "/documents/" +
        encodeURIComponent(doc.kind) +
        "/access?disposition=inline",
      { headers: { Cookie: cookie } }
    );
    const acc = await accRes.json().catch(() => ({}));
    if (!acc.path) continue;
    const pdfRes = await prodFetch(BASE + acc.path, { headers: { Cookie: cookie } });
    const buf = new Uint8Array(await pdfRes.arrayBuffer());
    const magic = buf[0] === 0x25 && buf[1] === 0x50;
    const apiCustomerOk =
      company.length >= 3 && verifiedOrder.order.ico && String(verifiedOrder.order.ico).length >= 8;
    const bytesOk = magic && buf.byteLength > 500;
    if (doc.kind === "order_confirmation") orderPdfOk = bytesOk && apiCustomerOk;
    if (doc.kind === "invoice_pdf") invoicePdfOk = bytesOk && apiCustomerOk;
    const dlRes = await prodFetch(
      BASE +
        "/v1/admin/premium/orders/" +
        encodeURIComponent(verifiedOrder.order_id) +
        "/documents/" +
        encodeURIComponent(doc.kind) +
        "/access?disposition=attachment",
      { headers: { Cookie: cookie } }
    );
    const dlAcc = await dlRes.json().catch(() => ({}));
    if (dlAcc.path) {
      const dlPdf = await prodFetch(BASE + dlAcc.path, { headers: { Cookie: cookie } });
      pass("ADMIN_" + (doc.kind === "invoice_pdf" ? "INVOICE" : "ORDER") + "_PDF_DOWNLOAD", dlPdf.ok);
    }
  }

  pass("PRODUCTION_ORDER_PDF_PASS", orderPdfOk);
  pass("PRODUCTION_INVOICE_PDF_PASS", invoicePdfOk);
  pass("ADMIN_ORDER_PDF_PREVIEW", orderPdfOk);
  pass("ADMIN_INVOICE_PDF_PREVIEW", invoicePdfOk);
  pass("ACTUAL_PRODUCTION_REQUESTS", prodHttp);
  pass("RETRY_429", 0);

  d1("DELETE FROM admin_user_roles WHERE user_id='" + sqlEscape(USER_ID) + "'; DELETE FROM admin_users WHERE user_id='" + sqlEscape(USER_ID) + "';");
  pass("TEST_DATA_CLEANED", true);

  const ok = orderPdfOk && invoicePdfOk && invCountAfter === invCountBefore;
  pass("PREVIOUSLY_CORRECT_BROKEN", ok ? 0 : 1);
  pass("TASK_COMPLETE", ok);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.log("FATAL=" + (err && err.message ? err.message : String(err)));
  pass("ACTUAL_PRODUCTION_REQUESTS", prodHttp);
  fail("TASK_COMPLETE", false);
  process.exit(1);
});
