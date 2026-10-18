#!/usr/bin/env node
/**
 * Offline CJ → normalize → gates → cards → staging snapshot (synthetic fixtures only).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeSqliteD1Shim } from "./iu-cj-affiliate-phase2-cj-email-d1-sqlite-shim.mjs";
import { migrateCentralOfferRegistryD1 } from "./iu-cj-affiliate-phase2-central-offer-d1-v29.mjs";
import { createD1SqlIngestApi } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-d1-sql-api.mjs";
import { executeIngestRpc } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-rpc-service.mjs";
import { D1_WORKER_RPC_OPS } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-rpc-ops.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { buildSectionOfferViewModel } from "./iu-cj-affiliate-phase2-offer-cards-view-model.mjs";
import { assessPublicationGates } from "./iu-cj-affiliate-phase2-publication-gates.mjs";
import { loadBindingContext, runPublicationPipelineForLinkProduct } from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINK = "17365257";
const PID = "IDN32844";

function sha256Json(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

const steps = [];

function step(id, pass, detail) {
  steps.push({ id, pass, detail });
}

const vm = await buildSectionOfferViewModel(null, {
  linkId: LINK,
  sectionKey: "aff-auto-moto",
  partnerSlug: "autohotarek",
});
step("normalize_and_cards", vm.ok === true, { productCount: vm.productCards?.length, coupon: Boolean(vm.coupon) });

const stateDir = vm.stateDir;
const ctx = await loadBindingContext(stateDir, LINK);
const pipeline = await runPublicationPipelineForLinkProduct(stateDir, LINK, PID, {
  refDate: new Date("2026-10-17T12:00:00Z"),
  fetchLanding: false,
});
step("revision_and_gates", !pipeline.error, {
  publicationReady: pipeline.publicationGatesTextOnly?.publicationReady,
  blockers: pipeline.publicationGatesTextOnly?.blockers?.slice(0, 5),
});

const blockedSynthetic = assessPublicationGates({
  productEval: { eligible: "ineligible", cardType: "limited_product" },
  product: { productId: "BLOCKED" },
  couponEval: { czPublishTrack: "not_for_cz_visitors" },
  programTermsImage: { state: "missing" },
  landingIdentity: { status: "fail", reason: "synthetic_block" },
  cardDisplayMode: "text_only",
  validity: {},
  linkMeta: {},
  refDate: new Date(),
});
step(
  "gate_blocks_unauthorized",
  blockedSynthetic.publicationReady === false && (blockedSynthetic.blockers?.length || 0) > 0,
  { blockers: blockedSynthetic.blockers }
);

const dbPath = path.join(repoRoot, "tmp-integration-chain-" + Date.now() + ".sqlite");
const shim = await createNodeSqliteD1Shim(dbPath);
await migrateCentralOfferRegistryD1(shim.db);
const api = await createD1SqlIngestApi(shim.db, { allowRegistryTestHooks: false });
const reg = await executeIngestRpc(
  api,
  "registryRegisterClaim",
  {
    source: "API",
    sourceRecordId: "integration-chain-synthetic",
    observedAt: "2026-11-01T10:00:00Z",
    meta: { sourceRevision: { revisionNumber: 1 } },
    fields: {
      network: "CJ",
      cjCid: "991001",
      advertiserId: "991001",
      market: "CZ",
      offerType: "coupon",
      couponCode: "INTCHAIN",
      productId: "w-int",
      assortmentScope: "w-int",
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
    },
    evidence: { synthetic: true },
    referenceTime: "2026-11-15T12:00:00Z",
  },
  D1_WORKER_RPC_OPS
);
step("registry_register_synthetic", reg.ok === true && reg.result?.ok === true, {
  reg: reg.ok ? { offerId: reg.result?.offerId } : reg,
});

const stagingSnapshot = {
  stagingOnly: true,
  productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
  viewModel: vm,
  registryOfferId: reg.result?.offerId || null,
  contentHash: sha256Json(vm),
};
step("staging_snapshot", stagingSnapshot.stagingOnly === true && !PRODUCTION_SIGNING_ENABLED, {
  productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
});

try {
  shim.db.close?.();
  fs.unlinkSync(dbPath);
} catch {
  /* ignore */
}

const ok = steps.every((s) => s.pass);
console.log(JSON.stringify({ IU_CJ_INTEGRATION_CHAIN: ok ? "OK" : "FAIL", steps, stagingSnapshot }));
process.exit(ok ? 0 : 1);
