/** Anonymized content fixtures (synthetic bodies) for affiliate classification tests. */
export const FIXTURE_BEZVASPORT_CZ = {
  id: "bezvasport_cz_multi_coupon",
  declaredCid: "5277391",
  subject: "Bezvasport CZ kampane",
  bodyText: [
    "CID: 5277391",
    "Kupón VSE20",
    "Extra 20 % na novinky",
    "LINK ID: 17361433",
    "Platnost do 31. 10. 2026",
    "",
    "Kupón STOCK50",
    "50 % na skladové zásoby",
    "LINK ID: 17361434",
    "Platnost do 31. 10. 2026",
  ].join("\n"),
};

export const FIXTURE_FACTCOOL_SK = {
  id: "factcool_sk_multi_coupon",
  declaredCid: "5402439",
  subject: "Factcool SK",
  bodyText: [
    "CID: 5402439",
    "Trhy: SK",
    "Kupón VSETKO20",
    "20 % na novinky",
    "LINK ID: 17370001",
    "Kupón STOCK50",
    "50 % na skladové zásoby",
    "Platnost do 31. 10. 2026",
  ].join("\n"),
};

export const FIXTURE_VIVANTIS_MULTI = {
  id: "vivantis_same_code_two_scopes",
  declaredCid: "4384608",
  bodyText: [
    "CID: 4384608",
    "Kupón: 10VIVA",
    "Sleva 10 % na vybrané produkty",
    "LINK ID: 18000001",
    "Kupón: WELEDA",
    "Sleva 20 % na Weleda Skin Food mimo dárkové sady do 1. 11. 2026 nebo vyprodání",
    "LINK ID: 18000002",
    "Kupón: YCWW15",
    "Sleva 15 % na Yankee Candle a WoodWick",
    "LINK ID: 18000003",
    "Kupón: 10VIVA",
    "Sleva 10 % na vybranou luxusní kosmetiku",
    "LINK ID: 18000004",
  ].join("\n"),
};

export const FIXTURE_SEPHORA_RHODE_BAN = {
  id: "sephora_rhode_ban",
  bodyText: "CID: 1111111\nNesmíte propagovat značku Rhode. Odstraňte produkty Rhode z feedu.",
};

export const FIXTURE_LEO_EXPRESS_ROUTE = {
  id: "leo_express_route_cancel",
  bodyText: "CID: 2222222\nOd 5. 10. 2026 přerušena mezinárodní trasa Praha–Kraków. Odstraňte dotčená spojení z nabídky.",
};

export const FIXTURE_BOOKING_EDITORIAL = {
  id: "booking_editorial",
  bodyText: "Booking.com inspirace destinacemi. Letenky, auta a atrakce — rozšíření programu, ne kupón.",
};

export const FIXTURE_CJ_DE_DIGEST = {
  id: "cj_de_multi_advertiser",
  bodyText: [
    "CJ Německo newsletter",
    "CID: 100001 T&C 10 % DE LINK ID: 90001",
    "CID: 100002 15 % kupón SPRING LINK ID: 90002",
    "CID: 100003 provize 8 % PL",
  ].join("\n"),
};

export const FIXTURE_KARCHER_PRODUCTS = {
  id: "kaercher_three_models",
  declaredCid: "3333333",
  bodyText: [
    "CID: 3333333",
    "Sleva 20 % automaticky na modely A, B, C",
    "1. 10. 2026 – 30. 11. 2026",
    "Produkt URL https://shop.example/a",
    "Bannery v příloze",
  ].join("\n"),
};

export const ALL_CONTENT_FIXTURES = [
  FIXTURE_BEZVASPORT_CZ,
  FIXTURE_FACTCOOL_SK,
  FIXTURE_VIVANTIS_MULTI,
  FIXTURE_SEPHORA_RHODE_BAN,
  FIXTURE_LEO_EXPRESS_ROUTE,
  FIXTURE_BOOKING_EDITORIAL,
  FIXTURE_CJ_DE_DIGEST,
  FIXTURE_KARCHER_PRODUCTS,
];

export function buildSyntheticMime(fixture) {
  const subj = fixture.subject || fixture.id;
  return [
    "From: partner@example.com",
    "To: affiliate@infouzel.cz",
    "Subject: =?utf-8?B?" + Buffer.from(subj, "utf8").toString("base64") + "?=",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    fixture.bodyText.replace(/[^\x00-\x7f]/g, "?"),
  ].join("\r\n");
}
