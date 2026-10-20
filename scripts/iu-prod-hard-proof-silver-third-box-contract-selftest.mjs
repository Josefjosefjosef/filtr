#!/usr/bin/env node
import {
  evaluateSilverTallScrollThirdBoxMinHeightContract,
  SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_PX,
} from "./iu-prod-hard-proof-silver-third-box-contract.mjs";

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(180, "auto", "none").ok === true,
  "floor_180_pass"
);
must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(0, "auto", "none").ok === true,
  "content_driven_zero_pass"
);
must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(179.5, "auto", "none").ok === true,
  "floor_tol_low_pass"
);
must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(250, "auto", "none").ok === false,
  "excessive_min_fail"
);
must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(100, "auto", "none").ok === false,
  "wrong_mid_min_fail"
);
must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(180, "auto", "40vh").ok === false,
  "vh_max_height_fail"
);
must(
  evaluateSilverTallScrollThirdBoxMinHeightContract(0.04, "auto", "none").ok === true,
  "content_driven_sub_half_px_pass"
);

console.log(
  "IU_PROD_HARD_PROOF_SILVER_THIRD_BOX_CONTRACT_SELFTEST_PASS=" + (fails.length === 0)
);
console.log("IU_SILVER_TALL_MIN_HEIGHT_PX=" + SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_PX);
if (fails.length) {
  console.log("IU_PROD_HARD_PROOF_SILVER_THIRD_BOX_CONTRACT_SELFTEST_FAILS=" + fails.join(","));
  process.exitCode = 1;
}
