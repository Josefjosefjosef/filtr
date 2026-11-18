#!/usr/bin/env node
/**
 * V51.8 — fetch-staging retry + partial link-stream fail-closed selftest.
 * No live CJ HTTP; exercises retry classification + outage decision rules.
 */
import assert from "node:assert/strict";

function isRetryableFetchFailure(res) {
  if (!res) return true;
  if (res.networkError) return true;
  const status = Number(res.status) || 0;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 0) return true;
  return false;
}

function decideApiOutage({ advertiserOk, couponOk, textOk, linksLen, couponMatched, textMatched }) {
  let apiOutage = false;
  const incompleteStreams = [];
  if (!advertiserOk) apiOutage = true;
  if (!couponOk) incompleteStreams.push("link_search_coupon");
  if (!textOk) incompleteStreams.push("link_search_text");
  if (!couponOk && !textOk) apiOutage = true;
  if (
    linksLen === 0 &&
    ((couponOk && (couponMatched || 0) > 0) || (textOk && (textMatched || 0) > 0))
  ) {
    apiOutage = true;
  }
  return {
    apiOutage,
    incompleteStreams,
    fetchComplete: incompleteStreams.length === 0 && !apiOutage,
  };
}

assert.equal(isRetryableFetchFailure({ networkError: true, status: 0 }), true);
assert.equal(isRetryableFetchFailure({ networkError: false, status: 429 }), true);
assert.equal(isRetryableFetchFailure({ networkError: false, status: 503 }), true);
assert.equal(isRetryableFetchFailure({ networkError: false, status: 400 }), false);
assert.equal(isRetryableFetchFailure({ networkError: false, status: 401 }), false);

// Historical 43855141956 shape: advertisers + one link stream OK → not full outage.
const partial = decideApiOutage({
  advertiserOk: true,
  couponOk: false,
  textOk: true,
  linksLen: 715,
  couponMatched: 0,
  textMatched: 800,
});
assert.equal(partial.apiOutage, false, "partial single-stream failure is not apiOutage");
assert.equal(partial.fetchComplete, false, "incompleteStreams keep fetchComplete=false");
assert.ok(partial.incompleteStreams.includes("link_search_coupon"));

const bothFail = decideApiOutage({
  advertiserOk: true,
  couponOk: false,
  textOk: false,
  linksLen: 0,
  couponMatched: 0,
  textMatched: 0,
});
assert.equal(bothFail.apiOutage, true, "both link streams fail → apiOutage");

const advFail = decideApiOutage({
  advertiserOk: false,
  couponOk: true,
  textOk: true,
  linksLen: 10,
  couponMatched: 10,
  textMatched: 10,
});
assert.equal(advFail.apiOutage, true, "advertiser lookup fail → apiOutage");

console.log(
  JSON.stringify({
    IU_CJ_FETCH_RETRY_PARTIAL_OUTAGE_SELFTEST: "PASS",
    partialApiOutage: partial.apiOutage,
    partialFetchComplete: partial.fetchComplete,
  })
);
