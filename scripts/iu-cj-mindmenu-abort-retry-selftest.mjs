import assert from "node:assert/strict";
import { navigationAbortShouldRetry } from "./iu-cj-navigation-abort-retry-v1.mjs";

assert.equal(navigationAbortShouldRetry(new Error("page.goto: net::ERR_ABORTED at http://127.0.0.1:30003/")), true);
assert.equal(navigationAbortShouldRetry("net::ERR_ABORTED"), true);
assert.equal(navigationAbortShouldRetry(new Error("locator.click: Element is outside of the viewport")), false);
assert.equal(navigationAbortShouldRetry(new Error("Failed to load resource: 404")), false);
assert.equal(navigationAbortShouldRetry(null), false);

process.stdout.write("IU_CJ_MINDMENU_ABORT_RETRY_SELFTEST PASS\n");
