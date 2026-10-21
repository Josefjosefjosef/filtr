#!/usr/bin/env node
import {
  auditApprovedFeedRegistry,
  buildFeedImportAuditRecord,
  loadApprovedProductFeedRegistry,
  resolveApprovedFeedHttpExecuteGate,
  validateApprovedFeedSourceUrl,
  validateRedirectTargetAllowed,
} from "./iu-cj-affiliate-phase2-approved-product-feed-lib.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const registry = loadApprovedProductFeedRegistry();
expect("registry_has_feeds", registry.feeds.length >= 1);

const audit = await auditApprovedFeedRegistry();
expect("registry_urls_ok", audit.ok === true);

const ssrf = await validateApprovedFeedSourceUrl({
  sourceUrl: "http://127.0.0.1/feed.xml",
  allowedHostSuffixes: ["example.com"],
});
expect("ssrf_private_blocked", ssrf.ok === false);

const badProto = await validateApprovedFeedSourceUrl({
  sourceUrl: "file:///etc/passwd",
  allowedHostSuffixes: [],
});
expect("file_protocol_blocked", badProto.ok === false);

const redirectBad = await validateRedirectTargetAllowed("http://169.254.169.254/", {
  allowedHostSuffixes: ["partner.cz"],
});
expect("redirect_metadata_blocked", redirectBad.ok === false);

const record = buildFeedImportAuditRecord(registry.feeds[0], {
  receivedCount: 10,
  rejectedCount: 2,
  duplicateCount: 1,
  importChecksum: "sha256:fixture",
});
expect("audit_publishable_false", record.publishable === false);
expect("audit_has_counts", record.receivedCount === 10 && record.rejectedCount === 2);

const gate = resolveApprovedFeedHttpExecuteGate({
  IU_CJ_UNATTENDED_IMPORT_OFFLINE: "1",
  IU_CJ_APPROVED_FEED_HTTP_EXECUTE: "1",
});
expect("http_execute_blocked_offline", gate.allowed === false);

console.log(
  JSON.stringify({
    IU_CJ_APPROVED_PRODUCT_FEED_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
