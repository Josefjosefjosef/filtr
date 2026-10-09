#!/usr/bin/env node
/**
 * Regression guard: admin premium order PDF cards must reflect D1 active documents,
 * not only premium_order_document_jobs rows (prevents false "missing" + missing buttons).
 * Run: npm run iu-premium-admin-order-documents-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const docsSrc = fs.readFileSync(path.join(ROOT, "cloudflare/iu-ads/src/premium-order-documents.ts"), "utf8");
const uiSrc = fs.readFileSync(path.join(ROOT, "cloudflare/iu-ads/src/admin-ui-script.ts"), "utf8");

ok("module:ensure_job_reflects_d1", /ensurePremiumOrderDocumentJobReflectsActiveDocument/.test(docsSrc));
ok(
  "list:uses_fetchActiveOrderDocument",
  /listPremiumOrderDocumentsForAdmin[\s\S]*fetchActiveOrderDocument/.test(docsSrc)
);
ok("list:ready_from_d1_not_job_only", /if \(active\)[\s\S]*status = "ready"/.test(docsSrc));
ok("ui:preview_download_buttons_when_ready", /d\.status==="ready"[\s\S]*data-premium-doc-preview/.test(uiSrc));
ok(
  "test:admin_documents_list",
  fs.existsSync(path.join(ROOT, "cloudflare/iu-ads/test/premium-order-admin-documents-list.test.ts"))
);

if (fails.length) {
  console.error("FAIL iu-premium-admin-order-documents-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-admin-order-documents-guard-v1");
