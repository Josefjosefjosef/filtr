/**
 * Replay guard: univerzální autodetekce dopravce musí odpovídat ručním formulářům.
 * Run: node scripts/iu-parcel-tracking-replay-guard.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENGINE_PATH = path.join(ROOT, "assets", "iu-parcel-tracking-engine.js");

function loadEngine() {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ENGINE_PATH, "utf8"), sandbox);
  const eng = sandbox.window.IU_PARCEL_TRACKING_ENGINE;
  assert.ok(eng, "IU_PARCEL_TRACKING_ENGINE missing");
  return eng;
}

function assertDetected(eng, tracking, expectedKey, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const det = eng.getCarrierDetectionResult(
    tracking,
    o.postal || "",
    o.hint || "",
  );
  assert.notEqual(
    det.state,
    "no_safe_match",
    `${tracking}: must not be no_safe_match (got ${det.state})`,
  );
  assert.notEqual(det.carrierKey, "", `${tracking}: carrierKey must be set`);
  assert.equal(
    det.carrierKey,
    expectedKey,
    `${tracking}: expected ${expectedKey}, got ${det.carrierKey}`,
  );
  const dest = eng.buildTrackingDestination(det, o.postal || "");
  assert.notEqual(dest.action, "none", `${tracking}: destination action must not be none`);
  assert.ok(dest.lastOfficialUrl, `${tracking}: lastOfficialUrl required`);
  return { det, dest };
}

const eng = loadEngine();

console.log("=== IU_PARCEL_TRACKING_REPLAY_GUARD ===");

/** 1) Produkční replay: DR6081444491U */
const dr = assertDetected(eng, "DR6081444491U", "balikovna");
assert.ok(
  dr.dest.url.includes("balikovna.cz"),
  "DR6081444491U must route to balikovna.cz",
);
assert.ok(
  dr.dest.url.includes("DR6081444491U"),
  "DR6081444491U deep link must include tracking code",
);

/** 2–4) Stavové scénáře — stejná autodetekce bez ohledu na stav zásilky */
const deliveredSample = assertDetected(eng, "DR6081444491U", "balikovna");
assert.equal(deliveredSample.det.state, "probable_match");
const inTransitSample = assertDetected(eng, "NB123456789F", "balikovna");
assert.equal(inTransitSample.det.state, "probable_match");
const pickupSample = assertDetected(eng, "NR987654321U", "balikovna");
assert.equal(pickupSample.det.state, "probable_match");

/** 5–10) Autodetekce podle dopravce */
assertDetected(eng, "Z1234567890", "packeta");
assertDetected(eng, "12345678901", "ppl");
assertDetected(eng, "12345678901234", "dpd");
assertDetected(eng, "1234567890", "dhl");
assertDetected(eng, "12345678", "wedo");
assertDetected(eng, "MSNG1234567", "messenger");

/** GLS vyžaduje PSČ — bez hintu zůstává neznámé, s hintem + PSČ funguje */
const glsNoPsc = eng.getCarrierDetectionResult("90312345678", "", "gls");
assert.equal(glsNoPsc.state, "needs_extra_input");
assert.equal(glsNoPsc.carrierKey, "gls");
const glsOk = assertDetected(eng, "90312345678", "gls", {
  hint: "gls",
  postal: "11000",
});
assert.equal(glsOk.det.state, "exact_match");
assert.equal(glsOk.dest.action, "open_base_clipboard");

/** Ruční hint musí fungovat pro všechny dopravce (jako ruční formulář) */
const manualKeys = [
  "packeta",
  "balikovna",
  "ppl",
  "dpd",
  "wedo",
  "dhl",
  "messenger",
];
for (const key of manualKeys) {
  assertDetected(eng, "TESTTRACK001", key, { hint: key });
}

/** UPU mezinárodní formát stále funguje */
assertDetected(eng, "RR123456789CZ", "balikovna");

/** Univerzální vs ruční: stejný engine pro Balíkovnu */
const universal = eng.getCarrierDetectionResult("DR6081444491U", "", "");
const manual = eng.getCarrierDetectionResult("DR6081444491U", "", "balikovna");
assert.equal(universal.carrierKey, manual.carrierKey);
assert.equal(
  eng.buildTrackingDestination(universal).url,
  eng.buildTrackingDestination(manual).url,
);

/** Nesmí skončit na neznámém dopravci, pokud existuje shoda */
const unknownStates = ["DR6081444491U", "Z999888777", "12345678901"];
for (const tn of unknownStates) {
  const d = eng.getCarrierDetectionResult(tn, "", "");
  assert.notEqual(d.carrierKey, "", `${tn} must resolve carrier`);
  assert.ok(eng.isRecognizedDetectionState(d.state), `${tn} must be recognized state`);
}

console.log("cases=" + (10 + manualKeys.length + 4));
console.log("PASS=true");
console.log("=== END_IU_PARCEL_TRACKING_REPLAY_GUARD ===");
