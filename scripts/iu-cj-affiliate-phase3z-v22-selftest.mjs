#!/usr/bin/env node
/**
 * V22 — email assortment false-positive guards (Booking, Kabea, Vivantis, etc.).
 */
import {
  buildAssortmentProfile,
} from "./iu-cj-affiliate-phase3z-assortment-v8.mjs";
import {
  suggestSectionIdFromEmailText,
  sanitizeEmailAssortmentText,
} from "./iu-cj-affiliate-phase3z-email-hints-bridge-v19.mjs";

const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

// Booking.com welcome — lodging, NOT travel agency
const bookingText =
  "Welcome to the Booking.com Affiliate Programme | Hello, Welcome to planet Earth's #1 accommodation site! Booking.com connects travellers with the world’s largest selection of incredible places to stay, including apartments, vacation homes, 5-star hotels.";
expect(
  "booking_not_travel_agency",
  suggestSectionIdFromEmailText(bookingText) === "aff-ubytovani-hotely",
  suggestSectionIdFromEmailText(bookingText)
);
expect(
  "booking_profile_lodging",
  buildAssortmentProfile({
    advertiser: { advertiserName: bookingText, programUrl: "", primaryCategory: "" },
  }).primaryAssortment?.sectionId === "aff-ubytovani-hotely"
);

// Kabea — leather goods / luggage → moda, NOT cestovní kancelář
const kabeaText =
  "Vítejte v affiliate programu e-shopu Kabea cz/sk! KABEA je největší e-shop kožené galanterie, kde najdete kabelky, tašky, batohy, peněženky i cestovní zavazadla.";
expect(
  "kabea_moda_not_agency",
  suggestSectionIdFromEmailText(kabeaText) === "aff-moda",
  suggestSectionIdFromEmailText(kabeaText)
);

// Vivantis — Weleda Skin Food must NOT become jidlo
const vivantisText =
  'Vážení publisheři, informujeme o kampani Vivantis.cz: Extra sleva 10% kódem 10VIVA. Weleda - Skin Food. Nakupte produkty Weleda Skin Food s 20% slevou.';
expect(
  "vivantis_skin_food_not_jidlo",
  suggestSectionIdFromEmailText(vivantisText) !== "aff-jidlo",
  {
    suggested: suggestSectionIdFromEmailText(vivantisText),
    sanitized: sanitizeEmailAssortmentText(vivantisText),
  }
);

// Kings Camo — "We invest each element" is NOT finance
const kingsText =
  "Welcome to the Kings Camo Affiliate Program! high-performance outdoor and hunting gear. We invest each element of our five-layer system.";
expect(
  "kings_camo_not_finance",
  suggestSectionIdFromEmailText(kingsText) !== "aff-finance",
  suggestSectionIdFromEmailText(kingsText)
);

// Bare travel without agency context → no travel-agency section
expect(
  "bare_travel_no_agency",
  suggestSectionIdFromEmailText("Welcome to the Acme Travel Affiliate Program! Start driving traffic.") !==
    "aff-cestovni-kancelare"
);

// Real travel agency still maps
expect(
  "real_agency_ok",
  suggestSectionIdFromEmailText(
    "Vítejte v programu Čedok. Pobytové a poznávací zájezdy, cestovní kancelář, dovolená."
  ) === "aff-cestovni-kancelare",
  suggestSectionIdFromEmailText(
    "Vítejte v programu Čedok. Pobytové a poznávací zájezdy, cestovní kancelář, dovolená."
  )
);

// Decathlon confirm still sport (apparel alone must not beat sport when both present)
expect(
  "decathlon_sport",
  (() => {
    const t = "Welcome to Decathlon. Sport outdoor fitness turistika equipment.";
    const s = suggestSectionIdFromEmailText(t);
    return s === "aff-sport-outdoor" || s === "aff-sportovni-obleceni";
  })(),
  suggestSectionIdFromEmailText("Welcome to Decathlon. Sport outdoor fitness turistika equipment.")
);

// Abracadabra costume still gifts
expect(
  "abracadabra_gifts",
  buildAssortmentProfile({
    advertiser: {
      advertiserName: "Halloween Costume Store Cosplay Collectibles Gift Shop",
      programUrl: "https://abracadabranyc.com",
      primaryCategory: "gifts & flowers|collectibles",
    },
  }).primaryAssortment?.sectionId === "aff-kvetiny-darky"
);

// Kytary instruments ≠ streaming
expect(
  "kytary_not_streaming",
  suggestSectionIdFromEmailText("Welcome to Kytary. Guitar hudební nástroje music instruments shop.") !==
    "aff-tv-streamovani"
);

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: "v22-email-assortment-guard" }, null, 2));
