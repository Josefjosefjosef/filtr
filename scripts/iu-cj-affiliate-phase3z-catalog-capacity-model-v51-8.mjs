/**
 * V51.8 — catalog capacity model (pure functions, no IO, no side effects).
 *
 * Extrapolates public JSON size, durable store size, sync minutes and deferred-new
 * backlog for scenario catalog sizes from ONE measured baseline.
 *
 * Every metric carries a label:
 *   MEASURED      – value comes directly from the baseline (scenario == baseline.uniqueProducts)
 *   EXTRAPOLATED  – value derived by the model (linear scaling + fixed overhead)
 *
 * Model assumptions (explicit, overridable via opts):
 *   - bytes per product = (publicBytes - fixedPublicBytes) / uniqueProducts   (linear)
 *   - durableBytes: baseline.durableBytes if provided, else publicBytes * durableToPublicRatio
 *   - syncMinutes: fixedSyncMinutes + perProductMinutes * products (linear; real runs may be worse)
 *   - deferredNew: scales with products/baseline.uniqueProducts (backlog proportional to catalog)
 */

export const CAPACITY_MODEL_SCHEMA = "iu-cj-affiliate-phase3z-catalog-capacity-model-v51-8";
export const DEFAULT_SCENARIOS = Object.freeze([
  5000, 10000, 25000, 50000, 100000, 200000, 300000,
]);
export const LABEL = Object.freeze({ MEASURED: "MEASURED", EXTRAPOLATED: "EXTRAPOLATED" });

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("capacity model: invalid " + name + ": " + v);
  return n;
}

export function normalizeBaseline(b = {}) {
  const uniqueProducts = num(b.uniqueProducts, "uniqueProducts");
  if (uniqueProducts <= 0) throw new Error("capacity model: uniqueProducts must be > 0");
  return {
    uniqueProducts,
    publicBytes: num(b.publicBytes, "publicBytes"),
    syncMinutes: num(b.syncMinutes, "syncMinutes"),
    deferredNew: num(b.deferredNew ?? 0, "deferredNew"),
    durableBytes: b.durableBytes == null ? null : num(b.durableBytes, "durableBytes"),
  };
}

export function normalizeOptions(o = {}) {
  return {
    fixedPublicBytes: num(o.fixedPublicBytes ?? 0, "fixedPublicBytes"),
    durableToPublicRatio: num(o.durableToPublicRatio ?? 1, "durableToPublicRatio"),
    fixedSyncMinutes: num(o.fixedSyncMinutes ?? 0, "fixedSyncMinutes"),
  };
}

const metric = (value, label) => ({ value, label });

/** Estimate one scenario. */
export function estimateScenario(baselineIn, products, optsIn = {}) {
  const b = normalizeBaseline(baselineIn);
  const o = normalizeOptions(optsIn);
  const n = num(products, "scenario products");
  const isBaseline = n === b.uniqueProducts;

  const bytesPerProduct = Math.max(0, (b.publicBytes - o.fixedPublicBytes) / b.uniqueProducts);
  const publicBytes = isBaseline ? b.publicBytes : Math.round(o.fixedPublicBytes + bytesPerProduct * n);

  const durableBaseline =
    b.durableBytes != null ? b.durableBytes : Math.round(b.publicBytes * o.durableToPublicRatio);
  const durablePerProduct = durableBaseline / b.uniqueProducts;
  const durableMeasured = isBaseline && b.durableBytes != null;
  const durableBytes = isBaseline ? durableBaseline : Math.round(durablePerProduct * n);

  const perProductMinutes = Math.max(0, (b.syncMinutes - o.fixedSyncMinutes) / b.uniqueProducts);
  const syncMinutes = isBaseline
    ? b.syncMinutes
    : Math.round((o.fixedSyncMinutes + perProductMinutes * n) * 100) / 100;

  const deferredNew = isBaseline ? b.deferredNew : Math.round((b.deferredNew / b.uniqueProducts) * n);

  return {
    products: n,
    publicJsonBytes: metric(publicBytes, isBaseline ? LABEL.MEASURED : LABEL.EXTRAPOLATED),
    publicJsonMiB: metric(
      Math.round((publicBytes / 1048576) * 100) / 100,
      isBaseline ? LABEL.MEASURED : LABEL.EXTRAPOLATED,
    ),
    durableBytes: metric(durableBytes, durableMeasured ? LABEL.MEASURED : LABEL.EXTRAPOLATED),
    syncMinutes: metric(syncMinutes, isBaseline ? LABEL.MEASURED : LABEL.EXTRAPOLATED),
    deferredNew: metric(deferredNew, isBaseline ? LABEL.MEASURED : LABEL.EXTRAPOLATED),
  };
}

/** Build the full model over scenarios. */
export function buildCatalogCapacityModel(baselineIn, opts = {}) {
  const baseline = normalizeBaseline(baselineIn);
  const scenarios = (opts.scenarios || DEFAULT_SCENARIOS).map(Number);
  const o = normalizeOptions(opts);
  return {
    schema: CAPACITY_MODEL_SCHEMA,
    baseline: {
      uniqueProducts: metric(baseline.uniqueProducts, LABEL.MEASURED),
      publicBytes: metric(baseline.publicBytes, LABEL.MEASURED),
      syncMinutes: metric(baseline.syncMinutes, LABEL.MEASURED),
      deferredNew: metric(baseline.deferredNew, LABEL.MEASURED),
      durableBytes:
        baseline.durableBytes != null
          ? metric(baseline.durableBytes, LABEL.MEASURED)
          : metric(Math.round(baseline.publicBytes * o.durableToPublicRatio), LABEL.EXTRAPOLATED),
    },
    assumptions: {
      ...o,
      growth: "linear",
      note: "Linear extrapolation is a lower bound for sync time; real runs may degrade (rate limits, retries).",
    },
    scenarios: scenarios.map((n) => estimateScenario(baseline, n, o)),
  };
}
