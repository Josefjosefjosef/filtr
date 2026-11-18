#!/usr/bin/env node
/**
 * V51.8 offline selftest: promote monotonicity gate predicates.
 * Mirrors cj-affiliate-catalog-sync.yml promote-offers-public-pr Resolve step.
 */
function sectionUnique(doc) {
  const s = new Set();
  for (const sec of doc.sections || []) {
    for (const p of sec.products || []) {
      const adv = String(p.advertiserId || "");
      const pid = String(p.productId || "");
      if (adv && pid) s.add(adv + "|" + pid);
    }
  }
  return s.size;
}

function evaluatePromoteMonotonic({ incoming, live, liveAvailable }) {
  if (incoming.liveEnabled !== true) {
    return { ok: true, note: "INCOMING_NOT_LIVE_YET" };
  }
  if (!liveAvailable || !live || live.liveEnabled !== true) {
    return {
      ok: false,
      blocker: "OFFERS_PROMOTE_LIVE_COMPARATOR_UNAVAILABLE",
    };
  }
  const liveTs = String(live.updatedAt || "");
  const inTs = String(incoming.updatedAt || "");
  const liveU = sectionUnique(live);
  const inU = sectionUnique(incoming);
  if (liveTs && inTs && inTs < liveTs) {
    return { ok: false, blocker: "OFFERS_PROMOTE_STALE_UPDATED_AT", liveTs, inTs };
  }
  if (liveU > 0 && inU < liveU * 0.9 && liveU - inU > 50) {
    return {
      ok: false,
      blocker: "OFFERS_PROMOTE_LIVE_UNIQUE_REGRESSION",
      liveU,
      inU,
    };
  }
  return { ok: true, liveTs, inTs, liveU, inU };
}

function products(n, prefix = "a") {
  return Array.from({ length: n }, (_, i) => ({
    advertiserId: prefix,
    productId: String(i + 1),
  }));
}

const cases = [];
function check(name, cond) {
  cases.push({ name, ok: !!cond });
  if (!cond) throw new Error("FAIL " + name);
}

const liveBase = {
  liveEnabled: true,
  updatedAt: "2026-11-18T12:17:32.899Z",
  sections: [{ products: products(100, "L") }],
};

check(
  "stale_updated_at_blocked",
  evaluatePromoteMonotonic({
    incoming: {
      liveEnabled: true,
      updatedAt: "2026-11-18T11:00:00.000Z",
      sections: [{ products: products(100, "L") }],
    },
    live: liveBase,
    liveAvailable: true,
  }).blocker === "OFFERS_PROMOTE_STALE_UPDATED_AT"
);

check(
  "unique_regression_blocked",
  evaluatePromoteMonotonic({
    incoming: {
      liveEnabled: true,
      updatedAt: "2026-11-18T13:00:00.000Z",
      sections: [{ products: products(20, "L") }],
    },
    live: liveBase,
    liveAvailable: true,
  }).blocker === "OFFERS_PROMOTE_LIVE_UNIQUE_REGRESSION"
);

check(
  "newer_ok",
  evaluatePromoteMonotonic({
    incoming: {
      liveEnabled: true,
      updatedAt: "2026-11-18T13:00:00.000Z",
      sections: [{ products: products(100, "L") }],
    },
    live: liveBase,
    liveAvailable: true,
  }).ok === true
);

check(
  "live_unavailable_fail_closed",
  evaluatePromoteMonotonic({
    incoming: {
      liveEnabled: true,
      updatedAt: "2026-11-18T13:00:00.000Z",
      sections: [{ products: products(100, "L") }],
    },
    live: null,
    liveAvailable: false,
  }).blocker === "OFFERS_PROMOTE_LIVE_COMPARATOR_UNAVAILABLE"
);

check(
  "non_live_incoming_skips_gates",
  evaluatePromoteMonotonic({
    incoming: { liveEnabled: false, updatedAt: "2026-11-18T10:00:00.000Z", sections: [] },
    live: null,
    liveAvailable: false,
  }).ok === true
);

console.log(
  JSON.stringify({
    IU_CJ_PROMOTE_MONOTONIC_V51_8_SELFTEST: "PASS",
    cases: cases.length,
  })
);
