#!/usr/bin/env node
import { runPartnerReconciliationSelftest } from "./iu-cj-affiliate-phase3z-complete-partner-reconciliation-v51-8.mjs";

const r = runPartnerReconciliationSelftest();
console.log(JSON.stringify({ IU_CJ_PARTNER_RECON_SELFTEST: r.ok ? "PASS" : "FAIL", ...r }, null, 2));
process.exit(r.ok ? 0 : 1);
