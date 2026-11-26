import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cjClickIdentity,
  protectedDestinationOk,
  rollbackStaticMainButtons,
  sameProtectedClick,
  syncStaticMainButtonsFromRegistry,
} from "./iu-cj-affiliate-phase3z-static-main-catalog-v13.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const click = "https://www.anrdoezrs.net/click-101883843-12920057";

function partner(id, extra = {}) {
  return {
    advertiserId: String(id),
    relationshipStatus: "joined",
    mainButtonReady: true,
    selectedClickUrl: click,
    sectionId: "aff-test",
    displayNameCs: "Partner " + id,
    management: "CJ_MANAGED",
    ...extra,
  };
}

function sync(partners, previous, opts) {
  return syncStaticMainButtonsFromRegistry({ partners }, previous, opts);
}

const previous = {
  generation: 4,
  publicButtonSwapArmed: true,
  liveEnabled: true,
  buttons: [partner("1")].map((row) => ({
    advertiserId: row.advertiserId,
    title: row.displayNameCs,
    url: row.selectedClickUrl,
    sectionId: row.sectionId,
  })),
};

const one = sync([partner("1")], previous);
assert.equal(one.ok, true);
assert.equal(one.catalog.counts.buttons, 1);

const added = sync([partner("1"), partner("2"), partner("3")], one.catalog);
assert.equal(added.ok, true);
assert.equal(added.catalog.counts.buttons, 3);

const ended = sync([partner("1"), partner("2", { relationshipStatus: "ended", mainButtonReady: false })], added.catalog);
assert.equal(ended.catalog.buttons.some((button) => button.advertiserId === "2"), false);

const nextUrl = "https://www.jdoqocy.com/click-101883843-15273907";
const urlChanged = sync([partner("1", { selectedClickUrl: nextUrl })], one.catalog);
assert.equal(urlChanged.catalog.buttons[0].url, nextUrl);

const sectionChanged = sync([partner("1", { sectionId: "aff-moda" })], one.catalog);
assert.equal(sectionChanged.catalog.buttons[0].sectionId, "aff-moda");

const czBlocked = sync([partner("1", { czMarketEligibility: false })], one.catalog);
assert.equal(czBlocked.catalog.counts.buttons, 0);
assert.equal(czBlocked.catalog.remainingBlockers[0].status, "CZ_NOT_ELIGIBLE");

const outage = sync([partner("1")], previous, { registryAvailable: false });
assert.equal(outage.ok, false);
assert.equal(outage.reason, "REGISTRY_OUTAGE");
assert.equal(outage.catalog, previous);

const incomplete = syncStaticMainButtonsFromRegistry({ partners: [] }, previous);
assert.equal(incomplete.reason, "INCOMPLETE_REGISTRY");
assert.equal(incomplete.catalog, previous);

const corrupt = sync([partner("1")], previous, { corruptSnapshot: true });
assert.equal(corrupt.reason, "CORRUPT_SNAPSHOT");
assert.equal(corrupt.catalog, previous);

const stale = sync([partner("1")], previous, { expectedGeneration: 1 });
assert.equal(stale.reason, "STALE_CONCURRENT_WRITE");
assert.equal(stale.catalog, previous);

const concurrent = sync([partner("1")], previous, { lockHeld: true });
assert.equal(concurrent.reason, "CONCURRENT_WRITE");

const paidPrevious = {
  ...previous,
  buttons: [{ advertiserId: "9", title: "Paid", url: click, sectionId: "aff-test" }],
};
const paid = sync(
  [partner("9", { management: "PAID_RESERVED", selectedClickUrl: nextUrl })],
  paidPrevious,
);
assert.equal(paid.ok, false);
assert.equal(paid.reason, "PAID_POSITION_PROTECTED");
assert.equal(paid.catalog, paidPrevious);

const rolled = rollbackStaticMainButtons(previous);
assert.equal(rolled.ok, true);
assert.equal(rolled.catalog, previous);

const onbuy = sync([partner("7417963", { displayNameCs: "OnBuy EU", mainButtonReady: true })], previous);
assert.equal(onbuy.catalog.buttons.some((button) => button.advertiserId === "7417963"), false);
const paragon = sync([partner("4686326", { displayNameCs: "Paragon", mainButtonReady: true })], previous);
assert.equal(paragon.catalog.buttons.some((button) => button.advertiserId === "4686326"), false);

const registry = JSON.parse(fs.readFileSync(path.join(root, "projects/data/iu-affiliate-cj-partner-registry-v1.json"), "utf8"));
const staticCatalog = JSON.parse(fs.readFileSync(path.join(root, "projects/data/iu-affiliate-cj-main-buttons-static-v13.json"), "utf8"));
const current = syncStaticMainButtonsFromRegistry(registry, staticCatalog);
assert.equal(current.ok, true);
assert.equal(current.catalog.buttons.some((button) => button.advertiserId === "7417963"), false);
assert.equal(current.catalog.buttons.some((button) => button.advertiserId === "4686326"), false);
const booking = current.catalog.buttons.find((button) => button.advertiserId === "5096493");
assert.equal(sameProtectedClick(booking.url, { publisherId: "101883843", linkId: "13386171" }), true);
assert.equal(booking.url, "https://www.tkqlhce.com/click-101883843-13386171-1779903990000");
const leo = current.catalog.buttons.find((button) => button.advertiserId === "6130482");
assert.equal(sameProtectedClick(leo.url, { publisherId: "101883843", linkId: "15237230" }), true);
assert.equal(leo.url, "https://www.dpbolvw.net/click-101883843-15237230-1753820095000");
const rotated = sync([
  partner("5096493", {
    displayNameCs: "Booking.com",
    sectionId: "aff-ubytovani-hotely",
    selectedClickUrl: "https://www.kqzyfj.com/click-101883843-13386171-1779903990000",
  }),
], previous);
assert.equal(rotated.catalog.buttons[0].url, "https://www.kqzyfj.com/click-101883843-13386171-1779903990000");
const wrongLink = sync([
  partner("5096493", {
    displayNameCs: "Booking.com",
    sectionId: "aff-ubytovani-hotely",
    selectedClickUrl: "https://www.tkqlhce.com/click-101883843-1-1",
  }),
], previous);
assert.equal(wrongLink.catalog.buttons.some((button) => button.advertiserId === "5096493"), false);
const bookingIdentity = { publisherId: "101883843", linkId: "13386171", destinationHost: "booking.com" };
for (const host of ["www.anrdoezrs.net", "www.jdoqocy.com", "www.dpbolvw.net", "www.kqzyfj.com", "www.tkqlhce.com"]) {
  const url = "https://" + host + "/click-101883843-13386171-1779903990000";
  assert.equal(cjClickIdentity(url).host, host);
  assert.equal(sameProtectedClick(url, bookingIdentity), true);
}
assert.equal(sameProtectedClick("https://www.anrdoezrs.net/click-999-13386171-1", bookingIdentity), false);
assert.equal(sameProtectedClick("https://www.anrdoezrs.net/click-101883843-1-1", bookingIdentity), false);
assert.equal(cjClickIdentity("https://evil.anrdoezrs.net/click-101883843-13386171-1"), null);
assert.equal(cjClickIdentity("https://www.anrdoezrs.net.evil.com/click-101883843-13386171-1"), null);
assert.equal(cjClickIdentity("https://example.com/?next=https://www.anrdoezrs.net/click-101883843-13386171-1"), null);
assert.equal(cjClickIdentity("http://www.anrdoezrs.net/click-101883843-13386171-1"), null);
assert.equal(cjClickIdentity("https://user:pass@www.anrdoezrs.net/click-101883843-13386171-1"), null);
assert.equal(cjClickIdentity("not a url www.anrdoezrs.net/click-101883843-13386171-1"), null);
assert.equal(protectedDestinationOk({ selectedDestination: "https://www.booking.com/" }, bookingIdentity), true);
assert.equal(protectedDestinationOk({ selectedDestination: "https://evil.example/booking.com" }, bookingIdentity), false);
const movedShop = sync([
  partner("5096493", {
    displayNameCs: "Booking.com",
    sectionId: "aff-ubytovani-hotely",
    selectedClickUrl: "https://www.tkqlhce.com/click-101883843-13386171-1779903990000",
    selectedDestination: "https://evil.example/",
  }),
], previous);
assert.equal(movedShop.catalog.buttons.some((button) => button.advertiserId === "5096493"), false);
const impostor = sync([
  partner("111111", {
    displayNameCs: "Not Booking",
    sectionId: "aff-ubytovani-hotely",
    selectedClickUrl: "https://www.tkqlhce.com/click-101883843-13386171-1779903990000",
  }),
], previous);
assert.equal(impostor.catalog.buttons.some((button) => button.advertiserId === "5096493"), false);
const start = current.catalog.counts.buttons;
const sizes = [];
for (const target of [start + 1, 200, 250, 500]) {
  const extra = [];
  for (let i = start; i < target; i += 1) {
    extra.push(partner(900000 + i, { displayNameCs: "Scale " + i, sectionId: "aff-scale" }));
  }
  const grown = syncStaticMainButtonsFromRegistry(
    { ...registry, partners: registry.partners.concat(extra) },
    current.catalog,
  );
  assert.equal(grown.ok, true);
  assert.equal(grown.catalog.counts.buttons, target);
  sizes.push(target);
}

function idsOf(catalog) {
  return (catalog.buttons || []).map((button) => String(button.advertiserId)).sort();
}
function cohort(count) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) rows.push(partner(String(100000 + i)));
  return rows;
}
function shrink(from, to) {
  const full = cohort(from);
  const base = sync(full, previous);
  assert.equal(base.ok, true);
  const kept = full.slice(0, to);
  const next = sync(kept, base.catalog);
  assert.equal(next.ok, true);
  assert.deepEqual(idsOf(next.catalog), kept.map((row) => row.advertiserId).sort());
  return { from, to, removed: from - to };
}
const shrinks = [shrink(195, 194), shrink(195, 178), shrink(250, 200), shrink(500, 250)];

const mixedBase = sync([partner("1"), partner("2"), partner("3")], previous);
const mixed = sync([partner("2"), partner("3"), partner("4")], mixedBase.catalog);
assert.equal(mixed.ok, true);
assert.deepEqual(idsOf(mixed.catalog), ["2", "3", "4"]);

const endedSet = sync([
  partner("1"),
  partner("2", { relationshipStatus: "ended" }),
], mixed.catalog);
assert.equal(endedSet.ok, true);
assert.deepEqual(idsOf(endedSet.catalog), ["1"]);
const rejoined = sync([
  partner("1"),
  partner("2", { relationshipStatus: "rejoined" }),
], endedSet.catalog);
assert.equal(rejoined.ok, true);
assert.deepEqual(idsOf(rejoined.catalog), ["1", "2"]);

const terms = sync([partner("1", { publicPromotionAllowed: false })], one.catalog);
assert.equal(terms.ok, true);
assert.deepEqual(idsOf(terms.catalog), []);

const duplicate = sync([partner("1"), partner("1", { displayNameCs: "Dup" })], previous);
assert.deepEqual(idsOf(duplicate.catalog), ["1"]);

const emptyKeeps = sync([], mixed.catalog);
assert.equal(emptyKeeps.ok, false);
assert.equal(emptyKeeps.reason, "INCOMPLETE_REGISTRY");
assert.deepEqual(idsOf(emptyKeeps.catalog), idsOf(mixed.catalog));

const sameInput = [partner("1"), partner("2")];
const firstPass = sync(sameInput, previous);
const secondPass = sync(sameInput, firstPass.catalog);
assert.deepEqual(idsOf(firstPass.catalog), idsOf(secondPass.catalog));
assert.equal(firstPass.catalog.manifest.sha256, secondPass.catalog.manifest.sha256);

console.log(JSON.stringify({
  IU_CJ_STATIC_CATALOG_SYNC_SELFTEST: "PASS",
  start,
  sizes,
  shrinks,
  onbuyPublished: false,
  paragonPublished: false,
}));
