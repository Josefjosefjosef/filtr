#!/usr/bin/env node
/** Offline negative scenarios for server ingest readiness (no live IMAP/CJ/HTTP). */
import { assertForpsiImapLiveConnectAllowed } from "./iu-forpsi-imap-credentials-interface.mjs";
import { resolveLiveIngestGate } from "./iu-cj-affiliate-phase2-github-actions-ingest-live-gate.mjs";
import { classifyProductFeedHttpStatus } from "./iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs";
import {
  parseAffiliateClickUrl,
  parseShoppingProductsGraphqlResponse,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  assessVariantEquivalence,
  merchantProductIdsEquivalent,
} from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";
import { resolveApprovedFeedHttpExecuteGate } from "./iu-cj-affiliate-phase2-approved-product-feed-lib.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { readTaggedFetchWithLiteral } from "./iu-cj-affiliate-phase2-forpsi-imap-protocol.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("production_signing_disabled", PRODUCTION_SIGNING_ENABLED === false);

const savedImap = {
  approved: process.env.IU_FORPSI_IMAP_CONNECT_APPROVED,
  user: process.env.IU_FORPSI_IMAP_USER,
  secret: process.env.IU_FORPSI_IMAP_SECRET,
};
delete process.env.IU_FORPSI_IMAP_CONNECT_APPROVED;
delete process.env.IU_FORPSI_IMAP_USER;
delete process.env.IU_FORPSI_IMAP_SECRET;
const noImap = assertForpsiImapLiveConnectAllowed();
if (savedImap.approved !== undefined) process.env.IU_FORPSI_IMAP_CONNECT_APPROVED = savedImap.approved;
else delete process.env.IU_FORPSI_IMAP_CONNECT_APPROVED;
if (savedImap.user !== undefined) process.env.IU_FORPSI_IMAP_USER = savedImap.user;
if (savedImap.secret !== undefined) process.env.IU_FORPSI_IMAP_SECRET = savedImap.secret;
expect("invalid_imap_credentials_gate", noImap.ok === false);

const liveGate = resolveLiveIngestGate({
  IU_CJ_LIVE_INGEST_APPROVED: "1",
  IU_FORPSI_IMAP_CONNECT_APPROVED: "1",
  IU_FORPSI_IMAP_USER: "affiliate@infouzel.cz",
  IU_FORPSI_IMAP_SECRET: "x",
  IU_CJ_D1_BACKEND: "mock",
});
expect("live_gate_blocks_without_worker_d1", liveGate.allowed === false);

const r429 = classifyProductFeedHttpStatus(429);
expect("http_429_rate_limited", r429.ok === false && r429.reason === "cj_api_rate_limited" && r429.retry === true);

const r500 = classifyProductFeedHttpStatus(500);
expect("http_500_retry", r500.ok === false && r500.reason === "cj_api_server_error" && r500.retry === true);

const foreignPid = parseAffiliateClickUrl(
  "https://www.dpbolvw.net/click-99999999-13734996?url=https%3A%2F%2Fshop.example%2Fp",
  "101883843"
);
expect("foreign_pid_mismatch", foreignPid.matchesExpectedWebsitePid === false);

const emptyCatalog = parseShoppingProductsGraphqlResponse({
  ok: true,
  status: 200,
  gqlErrors: [],
  json: { data: { shoppingProducts: { totalCount: 0, resultList: [] } } },
});
expect("empty_catalog_not_success_import", emptyCatalog.kind === "empty_catalog" && emptyCatalog.ok === true);

const badShape = parseShoppingProductsGraphqlResponse({
  ok: true,
  status: 200,
  gqlErrors: [],
  json: { data: {} },
});
expect("bad_json_shape_fail", badShape.ok === false);

expect(
  "variant_309152_not_merged",
  merchantProductIdsEquivalent("309152_1", "309152_2", "https://shop.example/309152.2-item") === false
);
expect(
  "variant_assess_not_equivalent",
  assessVariantEquivalence("309152_1", "309152_2", "https://shop.example/309152.2-item").equivalent === false
);

expect("approved_feed_http_offline", resolveApprovedFeedHttpExecuteGate({ IU_CJ_UNATTENDED_IMPORT_OFFLINE: "1" }).allowed === false);

let imapTimeout = false;
try {
  await readTaggedFetchWithLiteral(
    async () => {
      await new Promise((r) => setTimeout(r, 3));
      return "* STATUS";
    },
    async () => null,
    "A001",
    { deadlineMs: 5 }
  );
} catch (err) {
  imapTimeout = String(err?.message || err).includes("imap_read_timeout");
}
expect("imap_read_timeout", imapTimeout === true);

console.log(
  JSON.stringify({
    IU_CJ_SERVER_NEGATIVE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
