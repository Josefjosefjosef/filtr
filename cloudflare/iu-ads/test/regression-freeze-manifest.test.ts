import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEPLOY_IU_ADS_GUARD_SCRIPTS,
  REGRESSION_FREEZE_AREAS,
  REPO_REQUIRED_STATUS_CONTEXTS,
  uniqueGuardScriptsForPrWorkflow,
  uniqueVitestForPrWorkflow,
} from "../src/regression-freeze-manifest";

const IU_ADS_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(IU_ADS_ROOT, "../..");

describe("regression freeze manifest", () => {
  it("lists every PR vitest file on disk", () => {
    const missing: string[] = [];
    for (const rel of uniqueVitestForPrWorkflow()) {
      const abs = path.join(IU_ADS_ROOT, rel);
      if (!fs.existsSync(abs)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("lists every PR guard script on disk", () => {
    const missing: string[] = [];
    for (const rel of uniqueGuardScriptsForPrWorkflow()) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("deploy IU Ads guard scripts exist", () => {
    const missing: string[] = [];
    for (const rel of DEPLOY_IU_ADS_GUARD_SCRIPTS) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("covers core commercial areas", () => {
    const ids = new Set(REGRESSION_FREEZE_AREAS.map((a) => a.id));
    for (const required of [
      "public_order_forms",
      "catalog_p1_p8",
      "order_lifecycle",
      "billing_documents",
      "admin_ui",
      "dev_reset",
      "public_delivery_web",
      "privacy",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("documents repo required status context names", () => {
    expect(REPO_REQUIRED_STATUS_CONTEXTS.length).toBeGreaterThan(0);
    expect(REPO_REQUIRED_STATUS_CONTEXTS).toContain("smoke");
  });
});
