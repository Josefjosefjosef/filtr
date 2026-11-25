import {
  buildCatalogCapacityModel,
  DEFAULT_SCENARIOS,
  LABEL,
} from "./iu-cj-affiliate-phase3z-catalog-capacity-model-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const baseline = { uniqueProducts: 10000, publicBytes: 8_000_000, syncMinutes: 25, deferredNew: 1200 };
const m = buildCatalogCapacityModel(baseline, { fixedPublicBytes: 2_000, fixedSyncMinutes: 1 });

assert(m.scenarios.length === DEFAULT_SCENARIOS.length, "scenario count");
assert(
  m.scenarios.map((s) => s.products).join(",") === DEFAULT_SCENARIOS.join(","),
  "scenario list",
);

const keys = ["publicJsonBytes", "publicJsonMiB", "durableBytes", "syncMinutes", "deferredNew"];
for (const s of m.scenarios) {
  for (const k of keys) {
    assert(s[k] && typeof s[k].value === "number", s.products + " " + k + " value");
    assert(s[k].label === LABEL.MEASURED || s[k].label === LABEL.EXTRAPOLATED, s.products + " " + k + " label");
  }
}

for (let i = 1; i < m.scenarios.length; i++) {
  const p = m.scenarios[i - 1];
  const c = m.scenarios[i];
  assert(c.publicJsonBytes.value > p.publicJsonBytes.value, "public bytes monotonic at " + c.products);
  assert(c.durableBytes.value > p.durableBytes.value, "durable bytes monotonic at " + c.products);
  assert(c.syncMinutes.value >= p.syncMinutes.value, "sync minutes monotonic at " + c.products);
}

const at10k = m.scenarios.find((s) => s.products === 10000);
assert(at10k.publicJsonBytes.label === LABEL.MEASURED, "baseline-size scenario is MEASURED");
assert(at10k.publicJsonBytes.value === baseline.publicBytes, "baseline bytes preserved");
const at300k = m.scenarios.find((s) => s.products === 300000);
assert(at300k.publicJsonBytes.label === LABEL.EXTRAPOLATED, "300k is EXTRAPOLATED");
assert(m.baseline.publicBytes.label === LABEL.MEASURED, "baseline label");

console.log(
  JSON.stringify({
    IU_CJ_CATALOG_CAPACITY_MODEL_SELFTEST: "PASS",
    scenarios: m.scenarios.map((s) => ({
      products: s.products,
      publicBytes: s.publicJsonBytes.value,
      publicLabel: s.publicJsonBytes.label,
      syncMinutes: s.syncMinutes.value,
    })),
  }),
);
