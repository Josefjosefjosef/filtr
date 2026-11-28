#!/usr/bin/env node
import { evaluatePackOwnerGates } from "./iu-cj-affiliate-phase3z-final-autonomous-production-pack-v51-8.mjs";

const missing = evaluatePackOwnerGates({});
if (missing.preserved !== false || missing.growthExecuteDisarmed !== false || missing.emailOnlyPublishingDisarmed !== false) {
  console.error(JSON.stringify(missing));
  process.exit(1);
}
const disarmed = evaluatePackOwnerGates({
  growthExecute: "DISARMED",
  emailOnlyPublishing: "DISARMED",
  uncappedMode: false,
  executeArmed: false,
});
if (disarmed.preserved !== true) {
  console.error(JSON.stringify(disarmed));
  process.exit(1);
}
const armed = evaluatePackOwnerGates({
  growthExecute: "ARMED",
  emailOnlyPublishing: "DISARMED",
});
if (armed.preserved !== false || armed.executeArmed !== true) {
  console.error(JSON.stringify(armed));
  process.exit(1);
}
console.log(JSON.stringify({
  PACK_OWNER_GATES_SELFTEST: "PASS",
  missingPreserved: missing.preserved,
  disarmedPreserved: disarmed.preserved,
  armedExecute: armed.executeArmed,
}));
