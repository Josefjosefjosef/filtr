import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../assets/iu-affiliate-phase2-offers-v1.js", import.meta.url), "utf8");
const start = src.indexOf("function offersFailureDocumentPlan");
const end = src.indexOf("function lastGoodRequest");
assert.ok(start > 0 && end > start);
const fn = new Function(src.slice(start, end) + "\nreturn offersFailureDocumentPlan;");
const offersFailureDocumentPlan = fn();

assert.equal(offersFailureDocumentPlan(null, "aff-nabytek"), "FAIL");
assert.equal(offersFailureDocumentPlan({ liveEnabled: false, sections: [{ sectionKey: "aff-nabytek" }] }, "aff-nabytek"), "FAIL");
assert.equal(offersFailureDocumentPlan({ liveEnabled: true, ok: false, sections: [{ sectionKey: "aff-nabytek" }] }, "aff-nabytek"), "FAIL");
assert.equal(
  offersFailureDocumentPlan(
    { liveEnabled: true, sections: [{ sectionKey: "aff-cestovni-kancelare" }] },
    "aff-nabytek"
  ),
  "FAIL"
);
assert.equal(
  offersFailureDocumentPlan(
    { liveEnabled: true, sections: [{ sectionKey: "aff-nabytek", products: [{}] }] },
    "aff-nabytek"
  ),
  "USE"
);

process.stdout.write("IU_CJ_OFFERS_FAILURE_DOCUMENT_PLAN_SELFTEST PASS\n");
