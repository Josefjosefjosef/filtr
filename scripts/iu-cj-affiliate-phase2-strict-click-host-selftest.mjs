import assert from "node:assert/strict";
import { isTrustedCjClickHost } from "./iu-cj-affiliate-phase2-product-api.mjs";
import { verifyAffiliateUrl } from "./iu-cj-affiliate-phase2-partner-slot-planner-v1.mjs";

const good = "https://www.anrdoezrs.net/click-101883843-15802025";
assert.equal(isTrustedCjClickHost(good), true);
assert.equal(verifyAffiliateUrl(good).ok, true);
assert.equal(isTrustedCjClickHost("https://www.qksrv.net/click-101883843-15802025"), false);
assert.equal(isTrustedCjClickHost("https://www.cj.dotomi.com/click-101883843-15802025"), false);
assert.equal(isTrustedCjClickHost("https://anrdoezrs.net/click-101883843-15802025"), false);
assert.equal(isTrustedCjClickHost("https://evil.anrdoezrs.net/click-101883843-15802025"), false);
assert.equal(isTrustedCjClickHost("https://www.jdoqocy.com/click-101883843-1"), true);
assert.equal(isTrustedCjClickHost("https://www.dpbolvw.net/click-101883843-1"), true);
assert.equal(isTrustedCjClickHost("https://www.kqzyfj.com/click-101883843-1"), true);
assert.equal(isTrustedCjClickHost("https://www.tkqlhce.com/click-101883843-1"), true);

process.stdout.write("IU_CJ_STRICT_CLICK_HOST_SELFTEST PASS\n");
