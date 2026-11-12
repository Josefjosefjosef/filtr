import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  auditInvalidFeedCases,
  writeInvalidFeedCaseAudit,
} from "./iu-cj-affiliate-phase3z-invalid-feed-case-audit-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const fixture = {
  productMeta: {
    partners: [
      {
        advertiserId: "111",
        partnerName: "ExtA",
        error: "http_400",
        errorClass: "INVALID_FEED",
        feedId: "f1",
        lastSuccessAt: "2026-11-01T00:00:00.000Z",
      },
      {
        advertiserId: "222",
        partnerName: "ExtB",
        error: "http_400 bad request",
        feeds: 0,
      },
      {
        advertiserId: "333",
        partnerName: "Ok",
        error: null,
        fetched: 10,
      },
    ],
  },
};

const report = auditInvalidFeedCases(fixture);
assert(report.totalCases === 2, "two invalid cases");
assert(report.allExternal === true, "all external");
assert(report.implementationFixNeeded === false, "no impl fix");
assert(report.cases[0].continueOtherPartners === true, "continue others");
assert(report.cases[0].advertiserId === "111", "advertiser");

const out = path.join(os.tmpdir(), `iu-cj-invalid-feed-selftest-${Date.now()}.json`);
writeInvalidFeedCaseAudit(out, fixture);
assert(fs.existsSync(out), "wrote out");
fs.unlinkSync(out);

console.log(
  JSON.stringify({
    IU_CJ_INVALID_FEED_CASE_AUDIT_SELFTEST: "PASS",
    totalCases: report.totalCases,
    allExternal: report.allExternal,
  }),
);
