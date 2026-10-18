#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSectionOfferViewModel } from "./iu-cj-affiliate-phase2-offer-cards-view-model.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(repoRoot, "scripts", "fixtures", "cj-phase2-preview-autohotarek.json");
const publicStubPath = path.join(repoRoot, "assets", "cj-phase2-preview-autohotarek.json");
const assetsFullPath = path.join(repoRoot, "assets", "cj-phase2-preview-autohotarek.local-dev.json");

const vm = await buildSectionOfferViewModel(null, {
  linkId: "17365257",
  sectionKey: "aff-auto-moto",
  partnerSlug: "autohotarek",
});

const publicStub = {
  ok: false,
  schemaVersion: "cj_phase2_section_offers_v1",
  previewOnly: true,
  previewGate: "public_stub_no_staging_data",
  productionSigningEnabled: false,
  sectionKey: "",
  partnerSlug: "",
  productCards: [],
  coupon: null,
};

fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
fs.writeFileSync(fixturePath, JSON.stringify(vm, null, 2), "utf8");
fs.writeFileSync(publicStubPath, JSON.stringify(publicStub, null, 2), "utf8");
if (process.env.IU_CJ_PREVIEW_WRITE_ASSETS === "1") {
  fs.writeFileSync(assetsFullPath, JSON.stringify(vm, null, 2), "utf8");
}

console.log(
  JSON.stringify({
    IU_CJ_BUILD_SECTION_PREVIEW_JSON: vm.ok ? "OK" : "FAIL",
    fixturePath,
    publicStubPath,
    localDevPath: process.env.IU_CJ_PREVIEW_WRITE_ASSETS === "1" ? assetsFullPath : null,
    productCount: vm.productCards?.length ?? 0,
    couponReady: vm.coupon?.publicationReady ?? false,
  })
);
process.exit(vm.ok ? 0 : 1);
