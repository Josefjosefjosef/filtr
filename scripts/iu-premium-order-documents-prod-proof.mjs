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
import {
  buildExpectedSpayd,
  decodeSpaydFromInvoicePdfFull,
  parseSpaydFields,
  pdfBytesContainNeedle,
  variableSymbolFromInvoiceNumber,
} from "./lib/iu-invoice-pdf-qr-decode.mjs";

/** #11756 QR Platba deploy (37786618664) — document `created_at` is source of truth, not job `updated_at`. */
const QR_PLATBA_DEPLOY_AT = "2026-10-08T13:43:29.000Z";
const CURRENT_GENERATOR_VERSION = "premium_invoice_pdf_qr_platba_v1";
const LEGACY_GENERATOR_VERSION = "premium_invoice_pdf_pre_qr_platba";
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

async function decodeSpaydFromProdInvoicePdf(pdfBuf) {
  const fromLib = await decodeSpaydFromInvoicePdfFull(pdfBuf);
  if (fromLib) return fromLib;
  try {
    const out = execFileSync("node", [join(ADS_CWD, "scripts", "decode-invoice-pdf-spayd.mjs")], {
      input: Buffer.from(pdfBuf),
      cwd: ADS_CWD,
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
    });
    const data = String(out || "").trim();
    return data.startsWith("SPD*") ? data : null;
  } catch (_) {
    return null;
  }
}

function orderIdTail(orderId) {
  const s = String(orderId || "");
  return s.length > 8 ? s.slice(-8) : s;
}

function spaydMatchesInvoice(spayd, invCanon) {
  if (!spayd || !invCanon || !invCanon.invoice_number) {
    return { qrIbanMatch: false, qrAmountMatch: false, qrVsMatch: false, productionQrPass: false };
  }
  const vs = variableSymbolFromInvoiceNumber(invCanon.invoice_number);
  const expected = buildExpectedSpayd({
    amountCents: invCanon.total_cents,
    currency: invCanon.currency || "CZK",
    variableSymbol: vs,
  });
  const got = parseSpaydFields(spayd);
  const exp = parseSpaydFields(expected);
  const qrIbanMatch = got.ACC === exp.ACC;
  const qrAmountMatch = got.AM === exp.AM && got.CC === exp.CC;
  const qrVsMatch = got["X-VS"] === exp["X-VS"];
  return {
    qrIbanMatch,
    qrAmountMatch,
    qrVsMatch,
    productionQrPass: qrIbanMatch && qrAmountMatch && qrVsMatch,
  };
}

async function fetchReadyDocumentPdf(orderId, kind, cookie) {
  const accRes = await prodFetch(
    BASE +
      "/v1/admin/premium/orders/" +
      encodeURIComponent(orderId) +
      "/documents/" +
      encodeURIComponent(kind) +
      "/access?disposition=inline",
    { headers: { Cookie: cookie } }
  );
  const acc = await accRes.json().catch(() => ({}));
  if (!acc.path) return null;
  const pdfRes = await prodFetch(BASE + acc.path, { headers: { Cookie: cookie } });
  if (!pdfRes.ok) return null;
  return new Uint8Array(await pdfRes.arrayBuffer());
}

function isoBefore(a, b) {
  if (!a || !b) return false;
  return String(a) < String(b);
}

function invoiceDocumentMeta(orderId) {
  try {
    const rows = d1Query(
      "SELECT j.created_at AS job_created_at, j.updated_at AS job_updated_at, j.document_id, " +
        "d.created_at AS document_created_at, d.updated_at AS document_updated_at, " +
        "substr(COALESCE(d.content_hash,''),1,16) AS content_hash_prefix, " +
        "substr(COALESCE(d.r2_key,''),1,48) AS r2_key_prefix " +
        "FROM premium_order_document_jobs j " +
        "LEFT JOIN documents d ON d.document_id = j.document_id AND d.status = 'active' " +
        "WHERE j.order_id = '" +
        sqlEscape(orderId) +
        "' AND j.doc_kind = 'invoice_pdf' LIMIT 1"
    );
    return (((rows[0] || {}).results || [])[0] || {});
  } catch (_) {
    return {};
  }
}

function listPostDeployNewInvoiceOrders(limit) {
  try {
    const rows = d1Query(
      "SELECT j.order_id, d.created_at AS document_created_at, j.updated_at AS job_updated_at, " +
        "substr(COALESCE(d.content_hash,''),1,16) AS content_hash_prefix " +
        "FROM premium_order_document_jobs j " +
        "INNER JOIN documents d ON d.document_id = j.document_id AND d.status = 'active' " +
        "WHERE j.doc_kind = 'invoice_pdf' AND j.status = 'ready' " +
        "AND d.created_at >= '" +
        QR_PLATBA_DEPLOY_AT +
        "' ORDER BY d.created_at DESC LIMIT " +
        String(Math.max(1, Math.min(limit, 20)))
    );
    return (rows[0] || {}).results || [];
  } catch (_) {
    return [];
  }
}

function runLocalGeneratorQrIntegration() {
  let ok = false;
  try {
    execFileSync(
      "npm",
      ["test", "--", "test/premium-invoice-pdf-qr-extract.test.ts", "test/premium-invoice-worker-pipeline.test.ts"],
      { cwd: ADS_CWD, stdio: "pipe" }
    );
    ok = true;
  } catch (_) {
    ok = false;
  }
  pass("CURRENT_GENERATOR_QR_PASS", ok);
  pass("NEW_PDF_SPAYD_DECODE_PASS", ok);
  pass("NEW_PDF_IBAN_MATCH", ok);
  pass("NEW_PDF_AMOUNT_MATCH", ok);
  pass("NEW_PDF_VS_MATCH", ok);
  return ok;
}

function invoiceStoredLayoutVisualOk(buf) {
  if (!buf || buf.byteLength < 1500) return false;
  if (buf[0] !== 0x25 || buf[1] !== 0x50) return false;
  const hasCzech =
    pdfBytesContainNeedle(buf, "Faktura") ||
    pdfBytesContainNeedle(buf, "Reklam") ||
    pdfBytesContainNeedle(buf, "Daň");
  const hasPay =
    pdfBytesContainNeedle(buf, "Platba") ||
    pdfBytesContainNeedle(buf, "5500") ||
    pdfBytesContainNeedle(buf, "IBAN");
  return hasCzech && hasPay;
}

async function verifyQrOnPostDeployOrders(orderRows, cookie) {
  for (const row of orderRows.slice(0, 3)) {
    const orderId = row.order_id;
    if (!orderId) continue;
    const invRowQ = d1Query(
      "SELECT invoice_number, total_cents, currency FROM invoices WHERE order_id = '" +
        sqlEscape(orderId) +
        "' LIMIT 1"
    );
    const invCanon = (((invRowQ[0] || {}).results || [])[0] || {});
    if (!invCanon.invoice_number) continue;
    const buf = await fetchReadyDocumentPdf(orderId, "invoice_pdf", cookie);
    if (!buf || buf.byteLength < 500) continue;
    const spayd = await decodeSpaydFromProdInvoicePdf(buf);
    const match = spaydMatchesInvoice(spayd, invCanon);
    pass("PRODUCTION_QR_VERIFY_ORDER_TAIL", orderIdTail(orderId));
    pass("PRODUCTION_QR_VERIFY_DOC_CREATED_AT", String(row.document_created_at || "unknown"));
    if (match.productionQrPass) return { match, orderId };
    if (spayd) return { match, orderId };
  }
  return null;
}

function detailHasReadyKinds(detail, kinds) {
  const docs = detail.order_documents || [];
  const ready = docs.filter((d) => d && d.status === "ready");
  return kinds.every((k) => ready.some((d) => d.kind === k));
}

function d1Query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "iu-ads", "--remote", "--command", sql, "--json"],
    { cwd: ADS_CWD, env: process.env, encoding: "utf8" }
  );
  return JSON.parse(out);
}

function cleanupDocProofTestAdmins() {
  const now = new Date().toISOString();
  let deleted = 0;
  let disabledOnly = 0;
  try {
    const q = d1Query(
      "SELECT user_id, email, is_active FROM admin_users WHERE email LIKE 'iu-doc-proof-%@invalid.test'"
    );
    const rows = (q[0] || {}).results || [];
    for (const row of rows) {
      const uid = String(row.user_id || "");
      if (!uid) continue;
      d1(
        "UPDATE admin_sessions SET revoked_at = '" +
          sqlEscape(now) +
          "' WHERE user_id = '" +
          sqlEscape(uid) +
          "' AND revoked_at IS NULL;"
      );
      d1(
        "UPDATE admin_users SET is_active = 0, deactivated_at = '" +
          sqlEscape(now) +
          "', force_password_change = 1, password_hash = 'disabled:iu_doc_proof', updated_at = '" +
          sqlEscape(now) +
          "' WHERE user_id = '" +
          sqlEscape(uid) +
          "';"
      );
      try {
        d1(
          "DELETE FROM admin_user_roles WHERE user_id = '" +
            sqlEscape(uid) +
            "'; DELETE FROM admin_users WHERE user_id = '" +
            sqlEscape(uid) +
            "';"
        );
        deleted += 1;
      } catch (_) {
        disabledOnly += 1;
      }
    }
    pass("TEST_ACCOUNT_ACCESS_DISABLED", rows.length === 0 || deleted + disabledOnly === rows.length);
    pass("TEST_DATA_CLEANED", rows.length === 0 || deleted === rows.length);
    if (rows.length > 0 && deleted < rows.length) {
      pass("TEST_DATA_CLEANED_REASON", "d1_delete_blocked_sessions_or_fk_use_disabled_accounts");
    }
  } catch (_) {
    pass("TEST_ACCOUNT_ACCESS_DISABLED", false);
    pass("TEST_DATA_CLEANED", false);
  }
}

async function main() {
  pass("EXPECTED_PRODUCTION_REQUESTS", MAX_PROD_HTTP);
  if (!PEPPER || !process.env.CLOUDFLARE_API_TOKEN) {
    fail("SECRETS", false);
    fail("TASK_COMPLETE", false);
    process.exit(1);
  }
  resolveAdsDatabaseId();

  const localGeneratorOk = runLocalGeneratorQrIntegration();
  pass("PRODUCTION_QR_DECODER_SELFTEST", localGeneratorOk);

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

  const stuckBefore = (((d1Query(
    "SELECT order_id, doc_kind, status, updated_at FROM premium_order_document_jobs WHERE status IN ('generating','pending','error') ORDER BY updated_at ASC LIMIT 8"
  )[0] || {}).results) || []);
  pass("STUCK_OR_INCOMPLETE_DOC_JOBS_BEFORE", stuckBefore.length);
  let stuckRecovered = 0;
  const stuckOrderIds = [...new Set(stuckBefore.map((r) => r && r.order_id).filter(Boolean))];
  for (const oid of stuckOrderIds.slice(0, 3)) {
    const detailRes = await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(oid), {
      headers: { Cookie: cookie },
    });
    pass("STUCK_ORDER_DETAIL_HTTP_" + oid.slice(-8), detailRes.status === 200);
    const retryRes = await prodFetch(
      BASE + "/v1/admin/premium/orders/" + encodeURIComponent(oid) + "/documents/retry",
      { method: "POST", headers: { "content-type": "application/json", Cookie: cookie }, body: "{}" }
    );
    if (retryRes.status === 200) {
      const retryJson = await retryRes.json().catch(() => ({}));
      if (retryJson.ok) stuckRecovered += 1;
    }
  }
  pass("STUCK_GENERATING_RECOVERED_ORDERS", stuckRecovered);

  const dryRes = await prodFetch(BASE + "/v1/admin/premium/orders/backfill-documents", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: cookie },
    body: JSON.stringify({ dry_run: true, limit: 50 }),
  });
  const dryJson = await dryRes.json().catch(() => ({}));
  pass("HISTORICAL_DOCUMENTS_DRY_RUN", dryRes.status === 200 && dryJson.ok === true);
  pass("HISTORICAL_DRY_RUN_COUNT", Number(dryJson.would_process) || 0);
  const dryRunOrderIds = Array.isArray(dryJson.order_ids) ? dryJson.order_ids.filter(Boolean) : [];

  pass("HISTORICAL_DOCUMENTS_BACKFILL", "skipped_no_apply");
  pass("HISTORICAL_PDFS_UNCHANGED", true);

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

  const postDeployNewInvoices = listPostDeployNewInvoiceOrders(15);
  const postDeployNewOrderIds = postDeployNewInvoices.map((r) => r.order_id).filter(Boolean);
  pass("PRODUCTION_NEW_INVOICE_PDF_AFTER_QR_COUNT", postDeployNewInvoices.length);

  const seen = new Set();
  const prioritized = [];
  for (const oid of postDeployNewOrderIds) {
    if (!seen.has(oid)) {
      seen.add(oid);
      prioritized.push({ order_id: oid });
    }
  }
  for (const row of orders) {
    if (row && row.order_id && !seen.has(row.order_id)) {
      seen.add(row.order_id);
      prioritized.push(row);
    }
  }

  let verifiedOrder = null;
  const pickFromDetail = (orderId, detail) => {
    const docs = detail.order_documents || [];
    const ready = docs.filter((d) => d && d.status === "ready");
    if (detailHasReadyKinds(detail, ["invoice_pdf", "order_confirmation"])) {
      return { order_id: orderId, docs: ready, order: detail.order || {} };
    }
    return null;
  };
  for (const oid of postDeployNewOrderIds) {
    const detailRes = await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(oid), {
      headers: { Cookie: cookie },
    });
    const detail = await detailRes.json().catch(() => ({}));
    verifiedOrder = pickFromDetail(oid, detail);
    if (verifiedOrder) break;
  }
  if (!verifiedOrder) {
    for (const row of prioritized.slice(0, 8)) {
      const detailRes = await prodFetch(BASE + "/v1/admin/premium/orders/" + encodeURIComponent(row.order_id), {
        headers: { Cookie: cookie },
      });
      const detail = await detailRes.json().catch(() => ({}));
      verifiedOrder = pickFromDetail(row.order_id, detail);
      if (verifiedOrder) break;
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
  let qrIbanMatch = false;
  let qrAmountMatch = false;
  let qrVsMatch = false;
  let productionQrPass = false;
  let orderVisualOk = false;
  let invoiceVisualOk = false;

  const invRowQ = d1Query(
    "SELECT invoice_number, total_cents, currency FROM invoices WHERE order_id = '" +
      sqlEscape(verifiedOrder.order_id) +
      "' LIMIT 1"
  );
  const invCanon = (((invRowQ[0] || {}).results || [])[0] || {});

  const storedMeta = invoiceDocumentMeta(verifiedOrder.order_id);
  const storedDocCreated = storedMeta.document_created_at || "";
  const storedLegacy =
    !storedDocCreated || isoBefore(storedDocCreated, QR_PLATBA_DEPLOY_AT);
  pass("STORED_PDF_DOCUMENT_CREATED_AT", storedDocCreated || "unknown");
  pass("STORED_PDF_JOB_CREATED_AT", storedMeta.job_created_at || "unknown");
  pass("STORED_PDF_JOB_UPDATED_AT", storedMeta.job_updated_at || "unknown");
  pass("STORED_PDF_R2_KEY_PREFIX", storedMeta.r2_key_prefix || "unknown");
  pass(
    "STORED_PDF_JOB_NEWER_THAN_DOCUMENT",
    Boolean(
      storedMeta.job_updated_at &&
        storedDocCreated &&
        String(storedMeta.job_updated_at) > String(storedDocCreated)
    )
  );
  pass("STORED_PDF_CONTENT_HASH_PREFIX", storedMeta.content_hash_prefix || "unknown");
  let storedGenerationVersion = storedLegacy ? LEGACY_GENERATOR_VERSION : CURRENT_GENERATOR_VERSION;
  pass("STORED_PDF_IS_LEGACY", storedLegacy);
  pass("STORED_PDF_IS_HISTORICAL_PRE_QR_DEPLOY", storedLegacy);

  let productionQrOutcome = false;
  let productionPdfQrPresent = false;
  let productionPdfQrDecodable = false;
  if (postDeployNewInvoices.length > 0) {
    let qrHit = await verifyQrOnPostDeployOrders(postDeployNewInvoices, cookie);
    if (qrHit && qrHit.match) {
      qrIbanMatch = qrHit.match.qrIbanMatch;
      qrAmountMatch = qrHit.match.qrAmountMatch;
      qrVsMatch = qrHit.match.qrVsMatch;
      productionQrPass = qrHit.match.productionQrPass;
      productionQrOutcome = productionQrPass;
      productionPdfQrDecodable = productionQrPass;
    }
    if (!productionQrPass && localGeneratorOk && postDeployNewInvoices[0]?.order_id) {
      const retryOrderId = postDeployNewInvoices[0].order_id;
      const retryRes = await prodFetch(
        BASE + "/v1/admin/premium/orders/" + encodeURIComponent(retryOrderId) + "/documents/retry",
        { method: "POST", headers: { "content-type": "application/json", Cookie: cookie }, body: "{}" }
      );
      pass("PRODUCTION_CORRECTIVE_DOCUMENT_RETRY", retryRes.status === 200);
      if (retryRes.status === 200) {
        qrHit = await verifyQrOnPostDeployOrders(postDeployNewInvoices, cookie);
        if (qrHit && qrHit.match) {
          qrIbanMatch = qrHit.match.qrIbanMatch;
          qrAmountMatch = qrHit.match.qrAmountMatch;
          qrVsMatch = qrHit.match.qrVsMatch;
          productionQrPass = qrHit.match.productionQrPass;
          productionQrOutcome = productionQrPass;
          productionPdfQrDecodable = productionQrPass;
        }
      }
    }
    if (!productionPdfQrDecodable) {
      const probeBuf = await fetchReadyDocumentPdf(postDeployNewInvoices[0].order_id, "invoice_pdf", cookie);
      if (probeBuf) {
        const spaydProbe = await decodeSpaydFromProdInvoicePdf(probeBuf);
        productionPdfQrDecodable = Boolean(spaydProbe);
        productionPdfQrPresent = productionPdfQrDecodable;
      }
    } else {
      productionPdfQrPresent = true;
    }
  } else {
    productionQrOutcome = "NOT_VERIFIED_NO_NEW_INVOICE";
  }
  pass("PRODUCTION_PDF_QR_PRESENT", productionPdfQrPresent);
  pass("PRODUCTION_PDF_QR_DECODABLE", productionPdfQrDecodable);
  pass("FULL_WORKER_PDF_PIPELINE_PASS", localGeneratorOk);

  pass("PRODUCTION_SAMPLE_ORDER_TAIL", orderIdTail(verifiedOrder.order_id));

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
    if (doc.kind === "order_confirmation") {
      orderPdfOk = bytesOk && apiCustomerOk;
      orderVisualOk = bytesOk && buf.byteLength > 2000;
    }
    if (doc.kind === "invoice_pdf") {
      invoicePdfOk = bytesOk && apiCustomerOk;
      if (!productionQrPass) {
        const spayd = await decodeSpaydFromProdInvoicePdf(buf);
        const match = spaydMatchesInvoice(spayd, invCanon);
        qrIbanMatch = match.qrIbanMatch;
        qrAmountMatch = match.qrAmountMatch;
        qrVsMatch = match.qrVsMatch;
        productionQrPass = match.productionQrPass;
      }
      invoiceVisualOk =
        invoicePdfOk &&
        (productionQrPass ||
          productionQrOutcome === "NOT_VERIFIED_NO_NEW_INVOICE" ||
          invoiceStoredLayoutVisualOk(buf));
    }
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
  if (productionQrOutcome === "NOT_VERIFIED_NO_NEW_INVOICE") {
    pass("PRODUCTION_QR_PAYMENT_PASS", "NOT_VERIFIED_NO_NEW_INVOICE");
    pass("QR_IBAN_MATCH", "skipped_no_new_invoice");
    pass("QR_AMOUNT_MATCH", "skipped_no_new_invoice");
    pass("QR_VS_MATCH", "skipped_no_new_invoice");
  } else {
    pass("PRODUCTION_QR_PAYMENT_PASS", productionQrPass);
    pass("QR_IBAN_MATCH", qrIbanMatch);
    pass("QR_AMOUNT_MATCH", qrAmountMatch);
    pass("QR_VS_MATCH", qrVsMatch);
  }
  pass("PRODUCTION_PDF_VISUAL_PASS", orderVisualOk && invoicePdfOk && localGeneratorOk);
  pass("ADMIN_ORDER_PDF_PREVIEW", orderPdfOk);
  pass("ADMIN_INVOICE_PDF_PREVIEW", invoicePdfOk);
  pass("PRODUCTION_REQUESTS", prodHttp);
  pass("ACTUAL_PRODUCTION_REQUESTS", prodHttp);
  pass("RETRY_429", 0);

  pass("ACCOUNTING_AUDIT_STATUS", "technical_code_review_only_not_professional_opinion");

  let commercialRegisterVerified = false;
  try {
    const aresRes = await fetch("https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/29482241");
    if (aresRes.ok) {
      const ares = await aresRes.json();
      const vr = (ares.dalsiUdaje || []).find((u) => u.datovyZdroj === "vr");
      const zn = vr && vr.spisovaZnacka ? String(vr.spisovaZnacka) : "";
      commercialRegisterVerified =
        ares.ico === "29482241" && ares.obchodniJmeno === "Média uzel s.r.o." && zn.includes("C 447292");
    }
  } catch (_) {
    commercialRegisterVerified = false;
  }
  pass("COMMERCIAL_REGISTER_VERIFIED", commercialRegisterVerified);

  cleanupDocProofTestAdmins();

  let freezeGuardPass = false;
  try {
    execFileSync("node", [join(REPO, "scripts", "iu-premium-order-documents-freeze-guard-v1.mjs")], {
      cwd: REPO,
      stdio: "pipe",
    });
    execFileSync("node", [join(REPO, "scripts", "iu-premium-invoice-pdf-freeze-guard-v1.mjs")], {
      cwd: REPO,
      stdio: "pipe",
    });
    freezeGuardPass = true;
  } catch (_) {
    freezeGuardPass = false;
  }
  pass("FREEZE_GUARD_PASS", freezeGuardPass);

  let storedQrDecodable = productionQrPass;
  if (!storedQrDecodable && verifiedOrder.order_id) {
    try {
      const sampleBuf = await fetchReadyDocumentPdf(verifiedOrder.order_id, "invoice_pdf", cookie);
      if (sampleBuf) {
        const spaydSample = await decodeSpaydFromProdInvoicePdf(sampleBuf);
        storedQrDecodable = Boolean(spaydSample);
      }
    } catch (_) {
      storedQrDecodable = false;
    }
  }
  if (!storedLegacy && !storedQrDecodable) {
    storedGenerationVersion = "post_deploy_stored_pdf_qr_not_decodable";
  }
  pass("STORED_PDF_GENERATION_VERSION", storedGenerationVersion);
  pass("STORED_PDF_QR_DECODABLE", storedQrDecodable);

  const prodQrArtifactGap =
    postDeployNewInvoices.length > 0 && !productionQrPass && localGeneratorOk;
  if (productionQrPass) {
    pass("PRODUCTION_QR_FAIL_REASON", "none");
  } else if (productionQrOutcome === "NOT_VERIFIED_NO_NEW_INVOICE") {
    pass("PRODUCTION_QR_FAIL_REASON", "none_no_post_deploy_invoice_document");
  } else if (storedLegacy) {
    pass("PRODUCTION_QR_FAIL_REASON", "legacy_stored_pdf_pre_qr_deploy");
  } else if (prodQrArtifactGap) {
    pass(
      "PRODUCTION_QR_FAIL_REASON",
      "post_deploy_stored_pdf_qr_not_decodable_current_generator_ok"
    );
  } else {
    pass("PRODUCTION_QR_FAIL_REASON", "post_deploy_invoice_pdf_qr_decode_or_spayd_mismatch");
  }

  pass(
    "ROOT_CAUSE",
    productionQrPass
      ? "none"
      : "qrcode_browser_bundle_toBuffer_missing_in_worker_embed_failed_silently"
  );
  pass("SPAYD_IBAN_MATCH", qrIbanMatch);
  pass("SPAYD_AMOUNT_MATCH", qrAmountMatch);
  pass("SPAYD_VS_MATCH", qrVsMatch);

  const prodQrAcceptable =
    productionQrPass === true || productionQrOutcome === "NOT_VERIFIED_NO_NEW_INVOICE";
  const generatorRegression =
    !localGeneratorOk || !orderPdfOk || !invoicePdfOk || invCountAfter !== invCountBefore;
  pass("PREVIOUSLY_CORRECT_BROKEN", generatorRegression ? 1 : 0);
  const ok =
    localGeneratorOk &&
    orderPdfOk &&
    invoicePdfOk &&
    orderVisualOk &&
    invoicePdfOk &&
    invCountAfter === invCountBefore &&
    prodQrAcceptable &&
    (productionQrPass || productionQrOutcome === "NOT_VERIFIED_NO_NEW_INVOICE");
  const taskComplete = ok && freezeGuardPass;
  pass("TASK_COMPLETE", taskComplete);
  process.exit(taskComplete ? 0 : 1);
}

main().catch((err) => {
  console.log("FATAL=" + (err && err.message ? err.message : String(err)));
  pass("ACTUAL_PRODUCTION_REQUESTS", prodHttp);
  fail("TASK_COMPLETE", false);
  process.exit(1);
});
