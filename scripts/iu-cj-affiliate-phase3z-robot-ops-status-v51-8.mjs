#!/usr/bin/env node
/**
 * Operational status snapshot for CJ robot (no secrets, no mutations).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export function buildCjRobotOpsStatus(opts = {}) {
  const root = opts.root || process.cwd();
  const offers = readJson(path.join(root, "projects/data/iu-affiliate-cj-offers-public-v1.json"));
  const budget = offers?.publicGrowthBudget || {};
  const sections = Array.isArray(offers?.sections) ? offers.sections : [];
  let products = 0;
  let coupons = 0;
  let actions = 0;
  for (const s of sections) {
    products += (s.products || []).length;
    coupons += (s.coupons || []).length;
    actions += (s.actions || []).length;
  }
  const gate =
    String(opts.env?.IU_CJ_PUBLIC_GROWTH_UNCAPPED ?? process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED ?? "")
      .trim() === "1"
      ? "1"
      : "0";
  return {
    schema: "iu-cj-affiliate-phase3z-robot-ops-status-v51-8",
    at: new Date().toISOString(),
    production: {
      snapshotId: offers?.snapshotId || null,
      liveEnabled: offers?.liveEnabled === true,
      sections: sections.length,
      productsInSections: products,
      uniqueProducts: offers?.stats?.uniqueProducts ?? null,
      coupons,
      actions,
    },
    growth: {
      gate,
      cumulativeAddedSinceBaseline: budget.cumulativeAddedSinceBaseline ?? null,
      maxCumulativeAbs: budget.maxCumulativeAbs ?? null,
      allowedNew: budget.allowedNew ?? null,
      uncappedMode: budget.uncappedMode === true,
      autonomousActivation: "REQUIRES_SEPARATE_OWNER_APPROVAL",
    },
    security: {
      durableNonceWorker: "iu-cj-growth-approval-nonce",
      durableNonceD1: "iu-cj-growth-approval",
      runnerTempNonceAuthority: false,
    },
    ownerBlockers: [
      gate === "1" ? null : "GROWTH_GATE_LOCKED_0",
      Number(budget.allowedNew) === 0 ? "GROWTH_LEDGER_EXHAUSTED_OR_CAPPED" : null,
      "EMAIL_PUBLICATION_DISARMED_UNTIL_OWNER_IMAP_GO",
      "AUTONOMOUS_GROWTH_EXECUTE_REQUIRES_EXPLICIT_OWNER_APPROVAL",
    ].filter(Boolean),
  };
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const doc = buildCjRobotOpsStatus({});
  const out = process.env.IU_CJ_ROBOT_OPS_OUT;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  }
  console.log(JSON.stringify(doc, null, 2));
}
