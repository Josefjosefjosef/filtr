#!/usr/bin/env node
/**
 * V18 category content selftest — root-cause fixes for misfiles + keyword split + email bridge.
 */
import assert from "node:assert/strict";
import { buildAssortmentProfile } from "./iu-cj-affiliate-phase3z-assortment-v8.mjs";
import {
  applyMerchantEvidenceOverride,
  MERCHANT_EVIDENCE_OVERRIDES,
} from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import {
  buildMergedMainButtonEmailHintMap,
  emailHintToWebsiteEvidence,
  buildMainButtonEmailHint,
} from "./iu-cj-affiliate-phase3z-main-button-email-hints-v12.mjs";

function pass(name, cond, detail) {
  if (!cond) {
    console.error("FAIL", name, detail || "");
    process.exitCode = 1;
    return;
  }
  console.log("PASS", name);
}

// 1) Books keyword must NOT swallow music/games
{
  const music = buildAssortmentProfile({
    advertiser: {
      advertiserName: "Kytary Europe",
      programUrl: "https://www.kytary.cz/",
      primaryCategory: { parent: "Art/Photo/Music", child: "Music" },
    },
    links: [],
  });
  pass(
    "kytary_not_primary_knihy",
    music.primaryAssortment?.sectionId !== "aff-knihy",
    music.primaryAssortment
  );
  const toys = buildAssortmentProfile({
    advertiser: {
      advertiserName: "BAMBULE.cz",
      programUrl: "https://www.bambule.cz/",
      primaryCategory: { parent: "Toys", child: "Games" },
    },
    links: [{ linkName: "Hračky a hry", destination: "https://example.com/toys" }],
  });
  pass(
    "toys_not_primary_knihy",
    toys.primaryAssortment?.sectionId !== "aff-knihy",
    toys.primaryAssortment
  );
}

// 2) Merchant overrides present
pass("override_erkado", MERCHANT_EVIDENCE_OVERRIDES["5027071"]?.primaryAssortment?.sectionId === "aff-dum-zahrada");
pass("override_activa", MERCHANT_EVIDENCE_OVERRIDES["5260576"]?.primaryAssortment?.sectionId === "aff-kancelarske-potreby");
pass("override_tierra", MERCHANT_EVIDENCE_OVERRIDES["7612998"]?.primaryAssortment?.sectionId === "aff-drogerie");

{
  const erk = applyMerchantEvidenceOverride({
    advertiserId: "5027071",
    assortment: { primaryAssortment: { sectionId: "aff-dum-zahrada" } },
    baseSectionId: "aff-dilna-naradi",
  });
  pass("erkado_override_applied", erk.applied && erk.sectionId === "aff-dum-zahrada", erk);

  const act = applyMerchantEvidenceOverride({
    advertiserId: "5260576",
    assortment: {},
    baseSectionId: "aff-deti-hracky",
  });
  pass("activa_override_applied", act.applied && act.sectionId === "aff-kancelarske-potreby", act);

  const tv = applyMerchantEvidenceOverride({
    advertiserId: "7612998",
    assortment: {},
    baseSectionId: "aff-kosmetika",
  });
  pass("tierra_override_applied", tv.applied && tv.sectionId === "aff-drogerie", tv);
}

// 3) Email bridge: trusted hint → websiteEvidence; untrusted ignored
{
  const map = buildMergedMainButtonEmailHintMap();
  pass("email_fixtures_gant_cedok", map.has("4978487") && map.has("6179554"));
  const gantEv = emailHintToWebsiteEvidence(map.get("4978487"));
  pass("gant_email_evidence_moda", gantEv?.primaryAssortment?.sectionId === "aff-moda", gantEv);

  const untrusted = emailHintToWebsiteEvidence(
    buildMainButtonEmailHint({
      advertiserId: "999",
      trusted: false,
      suggestedSectionId: "aff-moda",
    })
  );
  pass("untrusted_email_no_evidence", untrusted === null);

  const forged = emailHintToWebsiteEvidence(
    buildMainButtonEmailHint({
      advertiserId: "",
      trusted: true,
      suggestedSectionId: "aff-moda",
    })
  );
  pass("empty_cid_not_trusted_evidence", forged === null);
}

// 4) Lidl regression — food primary preserved by override
{
  const lidl = applyMerchantEvidenceOverride({
    advertiserId: "5954793",
    assortment: {},
    baseSectionId: "aff-jidlo",
  });
  pass("lidl_stays_jidlo", lidl.sectionId === "aff-jidlo" || MERCHANT_EVIDENCE_OVERRIDES["5954793"]?.primaryAssortment?.sectionId === "aff-jidlo");
}

if (process.exitCode) {
  console.error(JSON.stringify({ ok: false }));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    phase: "3Z-V18",
    fixes: ["keyword_split_music_games", "overrides_erkado_activa_tierra", "email_assortment_bridge"],
  })
);
assert.equal(process.exitCode || 0, 0);
