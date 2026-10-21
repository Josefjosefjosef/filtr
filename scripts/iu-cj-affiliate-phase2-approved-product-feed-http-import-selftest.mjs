#!/usr/bin/env node
import { importApprovedProductFeedHttp } from "./iu-cj-affiliate-phase2-approved-product-feed-http-import-lib.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const graphqlOkBody = JSON.stringify({
  data: {
    shoppingProducts: {
      totalCount: 2,
      resultList: [
        { id: "A1", title: "One" },
        { id: "A1", title: "Dup" },
        { id: "B2", title: "Two" },
      ],
    },
  },
});

const mockOk = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  arrayBuffer: async () => Buffer.from(graphqlOkBody),
});

const gateBlocked = await importApprovedProductFeedHttp({ env: { IU_CJ_UNATTENDED_IMPORT_OFFLINE: "1" } });
expect("offline_blocks_without_mock", gateBlocked.ok === false && gateBlocked.reason === "offline_requires_mock_fetch");

const imported = await importApprovedProductFeedHttp({
  env: { IU_CJ_UNATTENDED_IMPORT_OFFLINE: "1" },
  mockFetch: mockOk,
});
expect("mock_import_ok", imported.ok === true);
expect("publishable_false", imported.publishable === false);
expect("dedupe", imported.productCount === 2);
expect("audit_counts", imported.audit?.duplicateCount === 1);

const mock401 = async () => ({
  ok: false,
  status: 401,
  headers: { get: () => "application/json" },
  arrayBuffer: async () => Buffer.from("{}"),
});
const authFail = await importApprovedProductFeedHttp({
  env: { IU_CJ_UNATTENDED_IMPORT_OFFLINE: "1" },
  mockFetch: mock401,
});
expect("http_401_fail", authFail.ok === false && authFail.reason === "cj_api_unauthorized");

const mockRedirectPrivate = async () => ({
  ok: true,
  status: 302,
  headers: { get: (h) => (h === "location" ? "http://127.0.0.1/x" : "") },
  arrayBuffer: async () => Buffer.from("{}"),
});
const redirectFail = await importApprovedProductFeedHttp({
  env: { IU_CJ_UNATTENDED_IMPORT_OFFLINE: "1" },
  mockFetch: mockRedirectPrivate,
});
expect("redirect_private_blocked", redirectFail.ok === false);

console.log(
  JSON.stringify({
    IU_CJ_APPROVED_PRODUCT_FEED_HTTP_IMPORT_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
