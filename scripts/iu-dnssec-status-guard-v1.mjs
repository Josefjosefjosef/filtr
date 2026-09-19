#!/usr/bin/env node
/**
 * DNSSEC external status guard for infouzel.cz (DoH only — no Cloudflare write).
 * PASS when DS + DNSKEY exist and validating resolvers set AD=1 on a signed query.
 * Run: node scripts/iu-dnssec-status-guard-v1.mjs
 */
import https from "https";

const ZONE = process.env.IU_DNSSEC_ZONE || "infouzel.cz";
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function doh(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { accept: "application/dns-json" } }, (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function answers(j, type) {
  return (j.Answer || []).filter((a) => a.type === type);
}

async function main() {
  const dnskeyCf = await doh(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(ZONE)}&type=DNSKEY`
  );
  const dsGoogle = await doh(
    `https://dns.google/resolve?name=${encodeURIComponent(ZONE)}&type=DS`
  );
  const dnskeyGoogle = await doh(
    `https://dns.google/resolve?name=${encodeURIComponent(ZONE)}&type=DNSKEY`
  );
  const aGoogle = await doh(
    `https://dns.google/resolve?name=${encodeURIComponent(ZONE)}&type=A&do=1`
  );

  const dnskeyAns = answers(dnskeyGoogle, 48);
  const dsAns = answers(dsGoogle, 43);
  const aAns = answers(aGoogle, 1);

  console.log(
    "IU_DNSSEC_STATUS=" +
      JSON.stringify({
        zone: ZONE,
        dnskeyCount: dnskeyAns.length,
        dsCount: dsAns.length,
        aCount: aAns.length,
        dnskeyAd: !!dnskeyGoogle.AD,
        dsAd: !!dsGoogle.AD,
        aAd: !!aGoogle.AD,
        dnskeyStatus: dnskeyGoogle.Status,
        dsStatus: dsGoogle.Status,
        sampleDnskey: dnskeyAns.slice(0, 2).map((a) => a.data),
        sampleDs: dsAns.slice(0, 2).map((a) => a.data),
        cfDnskeyPresent: answers(dnskeyCf, 48).length > 0,
      })
  );

  must(dnskeyAns.length > 0, "missing_dnskey");
  must(dsAns.length > 0, "missing_ds");
  must(aAns.length > 0, "missing_a");
  /* Validating resolver should authenticate the answer once chain is complete. */
  must(aGoogle.AD === true || dnskeyGoogle.AD === true, "ad_bit_not_set");
  must(dnskeyGoogle.Status === 0 && dsGoogle.Status === 0, "resolver_status_not_nokey");

  if (fails.length) {
    console.error("IU_DNSSEC_STATUS_GUARD_FAIL");
    for (const f of fails) console.error(f);
    process.exit(1);
  }
  console.log("IU_DNSSEC_STATUS_GUARD_PASS");
}

main().catch((e) => {
  console.error("IU_DNSSEC_STATUS_GUARD_ERROR", e && e.stack ? e.stack : String(e));
  process.exit(2);
});
