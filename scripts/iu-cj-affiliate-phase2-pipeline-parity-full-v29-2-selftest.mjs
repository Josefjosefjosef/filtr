#!/usr/bin/env node
/** Portable pipeline_parity_full — uses fixtures next to script (audit ZIP safe). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./iu-cj-affiliate-phase1-lib.mjs";
import { pipelineStateFingerprint, runPublicationPipelineForLinkProduct } from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureCandidates = [
  path.join(scriptsRoot, "fixtures", "pipeline-parity-v29-2", "state"),
  path.join(scriptsRoot, "scripts", "fixtures", "pipeline-parity-v29-2", "state"),
];
const fixtureState = fixtureCandidates.find((p) => fs.existsSync(p)) || fixtureCandidates[0];
const LINK = "17365257";
const PID = "IDN32844";
const refDate = new Date("2026-10-17T12:00:00Z");

if (!fs.existsSync(fixtureState)) {
  console.log(
    JSON.stringify({
      IU_CJ_PIPELINE_PARITY_FULL_V29_2_SELFTEST: "FAIL",
      reason: "missing_fixture_state",
      fixtureState,
    })
  );
  process.exit(1);
}

const pipeline = await runPublicationPipelineForLinkProduct(fixtureState, LINK, PID, { refDate, fetchLanding: false });
if (pipeline?.error) {
  console.log(JSON.stringify({ IU_CJ_PIPELINE_PARITY_FULL_V29_2_SELFTEST: "FAIL", pipelineError: pipeline.error }));
  process.exit(1);
}

const cardControl = readJson(path.join(fixtureState, "cj-phase2-autohotarek-card-probe-v25-control.json"), null);
const reeval = readJson(path.join(fixtureState, "cj-phase2-coupon-product-bindings-reeval.json"), { bindings: [] });
const binding = reeval.bindings.find((b) => String(b.linkId) === LINK);
const row = binding?.productRowsEvaluated?.find((p) => String(p.productId) === PID);

const fpPipeline = JSON.stringify(pipelineStateFingerprint(pipeline));
const fpCard = JSON.stringify(cardControl?.fingerprint || null);
const fpReeval = JSON.stringify(
  row
    ? {
        landing: row?.landingIdentity?.status,
        landingReason: row?.landingIdentity?.reason,
        publicationReady: row?.publicationGatesTextOnly?.publicationReady,
        blockers: row?.publicationGatesTextOnly?.blockers || [],
        couponProductEligible: row?.publicationGatesTextOnly?.couponProductEligible,
        affiliateLinkValid: row?.publicationGatesTextOnly?.affiliateLinkValid,
      }
    : null
);

const coreOk = fpPipeline === fpReeval;
const controlOk = cardControl ? fpPipeline === fpCard : false;
const ok = coreOk && controlOk;

console.log(
  JSON.stringify({
    IU_CJ_PIPELINE_PARITY_FULL_V29_2_SELFTEST: ok ? "OK" : "FAIL",
    IU_CJ_PIPELINE_PARITY_CORE: coreOk ? "OK" : "FAIL",
    IU_CJ_PIPELINE_PARITY_V25_CONTROL: controlOk ? "OK" : cardControl ? "FAIL" : "NOT_VERIFIED",
    fixtureState,
    failureCause: !coreOk ? "pipeline_vs_reeval_mismatch" : !controlOk ? "pipeline_vs_control_mismatch" : null,
  })
);
process.exit(ok ? 0 : 1);
