#!/usr/bin/env node
import {
  classifyFirstClick,
  FIRST_CLICK_RESULT,
} from "./iu-cj-affiliate-phase3z-first-click-v50.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

assert(
  classifyFirstClick({ href: "https://www.tkqlhce.com/x", popupOpened: true, popupUrl: "https://www.tkqlhce.com/x" })
    .result === FIRST_CLICK_RESULT.PASS_POPUP_OPENED,
  "popup opened"
);
assert(
  classifyFirstClick({
    href: "https://www.tkqlhce.com/x",
    popupOpened: false,
    sameTabNavigated: true,
    afterUrl: "https://merchant.example/p",
  }).result === FIRST_CLICK_RESULT.PASS_SAME_TAB_NAVIGATION,
  "same tab"
);
assert(
  classifyFirstClick({
    href: "https://www.tkqlhce.com/x",
    popupOpened: false,
    sameTabNavigated: false,
    afterUrl: "https://infouzel.cz/?section=aff-nabytek",
  }).result === FIRST_CLICK_RESULT.BLOCKED_BY_BROWSER,
  "blocked"
);
assert(
  classifyFirstClick({ href: "#", hrefBroken: true }).result === FIRST_CLICK_RESULT.LINK_BROKEN,
  "broken"
);
assert(
  classifyFirstClick({ href: null }).result === FIRST_CLICK_RESULT.LINK_BROKEN,
  "null href"
);

console.log(JSON.stringify({ V50_FIRST_CLICK_SELFTEST: "PASS" }));
