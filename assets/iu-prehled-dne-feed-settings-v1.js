/**
 * Přehled dne — new Doprava / ČHMÚ settings UI (HTML builders + summaries).
 * Used by iu-prehled-dne-ui-v1.js. Presentation only.
 */
import {
  EVENT_USER_CATEGORIES,
  ROAD_FILTER_GROUPS,
  buildRoadCatalogFromTrafficItems,
  defaultChmuFilter,
  defaultTrafficFilter,
  ensureFeedFilter,
  parkingCitiesFromRegistry,
  sanitizeFeedFilter,
  summarizeEventCategories,
  summarizeLocalities,
  summarizeParking,
  summarizeRoads,
} from "./iu-feed-filter-v1.js?v=feed-filter-redesign-v1-20260817";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getDraftFeedFilter(draft) {
  return ensureFeedFilter(draft || {});
}

export function setDraftFeedFilter(draft, ff) {
  if (!draft) return;
  draft.feedFilter = sanitizeFeedFilter(ff);
}

export function mainFeedSettingsHtml(draft) {
  const ff = getDraftFeedFilter(draft);
  const row = (kind, enabled, label, accent) =>
    `<div class="iuPdFeedMainRow iuPdFeedMainRow--${esc(accent)}" data-iu-feed-kind="${esc(kind)}">` +
    `<label class="iuPdFeedMainRow__check">` +
    `<input type="checkbox" data-act="feed-main-toggle" data-kind="${esc(kind)}"${enabled ? " checked" : ""} />` +
    `<span class="iuPdFeedMainRow__label">${esc(label)}</span>` +
    `</label>` +
    `<button type="button" class="iuPdFeedMainRow__gear" data-act="feed-open-detail" data-kind="${esc(
      kind
    )}" aria-label="Nastavení: ${esc(label)}">Nastavení ⚙️</button>` +
    `</div>`;
  return (
    `<div class="iuPdFeedMain" data-iu-pd-feed-main="1">` +
    row("traffic", ff.trafficEnabled, "Dopravní informace", "traffic") +
    row("chmu", ff.chmuEnabled, "Výstrahy ČHMÚ", "chmu") +
    `</div>`
  );
}

function accordionSection(id, title, summary, open, bodyHtml) {
  return (
    `<section class="iuPdFeedAcc" data-iu-feed-acc="${esc(id)}">` +
    `<button type="button" class="iuPdFeedAcc__toggle" data-act="feed-acc-toggle" data-id="${esc(
      id
    )}" aria-expanded="${open ? "true" : "false"}">` +
    `<span class="iuPdFeedAcc__title">${esc(title)}</span>` +
    `<span class="iuPdFeedAcc__sum">${esc(summary)}</span>` +
    `<span class="iuPdFeedAcc__chev" aria-hidden="true"></span>` +
    `</button>` +
    (open ? `<div class="iuPdFeedAcc__body">${bodyHtml}</div>` : "") +
    `</section>`
  );
}

function checkItem(act, value, label, checked, extraAttrs) {
  return (
    `<label class="iuPdFeedCheck">` +
    `<input type="checkbox" data-act="${esc(act)}" data-value="${esc(value)}"${checked ? " checked" : ""}${
      extraAttrs || ""
    } />` +
    `<span>${esc(label)}</span>` +
    `</label>`
  );
}

/** Shared locality picker pieces (kraje / optional okresy / město). */
export function localityPickerHtml(opts) {
  const {
    localities,
    krajeList,
    okresyMap,
    includeOkresy,
    cityQuery,
    citySuggest,
    selCities,
    cityLimitMsg,
  } = opts;
  const locs = Array.isArray(localities) ? localities : [];
  const selectedKraje = new Set(locs.filter((l) => l.level === "kraj").map((l) => l.name));
  const selectedOkresy = new Set(locs.filter((l) => l.level === "okres").map((l) => l.name));
  const wholeCr = locs.length === 0;
  const krajChecks = (krajeList || [])
    .map((k) => checkItem("feed-loc-kraj", k, k, selectedKraje.has(k)))
    .join("");
  let okresBlock = "";
  if (includeOkresy) {
    const okresNames = [];
    for (const k of selectedKraje) {
      const arr = (okresyMap && okresyMap[k]) || [];
      for (const o of arr) okresNames.push(o);
    }
    if (!selectedKraje.size) {
      okresBlock =
        `<p class="iuPdFeedHint">Nejdříve vyberte kraj, nebo ponechte Celá ČR.</p>`;
    } else {
      okresBlock =
        `<div class="iuPdFeedSub">` +
        `<div class="iuPdFeedSub__head">Okresy</div>` +
        okresNames
          .map((o) => checkItem("feed-loc-okres", o, o, selectedOkresy.has(o)))
          .join("") +
        `</div>`;
    }
  }
  const suggest =
    (citySuggest || []).length > 0
      ? `<ul class="iuPdSuggest" role="listbox">${(citySuggest || [])
          .map(
            (s) =>
              `<li><button type="button" class="iuPdSuggest__item" data-act="feed-city-add" data-name="${esc(
                s.name
              )}" data-id="${esc(s.id || "")}" data-orp="${esc(s.orpCode || "")}">${esc(s.name)}</button></li>`
          )
          .join("")}</ul>`
      : "";
  const chips = (selCities || []).length
    ? `<div class="iuPdChips">${(selCities || [])
        .map(
          (c) =>
            `<button type="button" class="iuPdChip" data-act="feed-city-remove" data-name="${esc(
              c.name
            )}" data-id="${esc(c.id || "")}">${esc(c.name)} ×</button>`
        )
        .join("")}</div>`
    : "";
  return (
    `<div class="iuPdFeedLocality" data-iu-feed-locality="1">` +
    checkItem("feed-loc-cr", "1", "Celá ČR", wholeCr) +
    `<div class="iuPdFeedSub"><div class="iuPdFeedSub__head">Kraje</div>${krajChecks}</div>` +
    okresBlock +
    `<div class="iuPdFeedSub">` +
    `<div class="iuPdFeedSub__head">Město / obec</div>` +
    `<input type="search" class="iuPdFeedSearch" placeholder="Město / obec" value="${esc(
      cityQuery || ""
    )}" data-act="feed-city-q" autocomplete="off" />` +
    (cityLimitMsg ? `<p class="iuPdFeedHint">${esc(cityLimitMsg)}</p>` : "") +
    suggest +
    chips +
    `</div></div>`
  );
}

function roadsBodyHtml(traffic, catalog, roadQuery, openRoadGroups) {
  const selected = new Set((traffic.roads || []).map((r) => String(r).toUpperCase()));
  const q = String(roadQuery || "")
    .trim()
    .toUpperCase();
  const open = openRoadGroups || {};
  const groups = ROAD_FILTER_GROUPS.map((g) => {
    let roads = (catalog && catalog.byClass && catalog.byClass[g.roadClass]) || [];
    if (q) roads = roads.filter((r) => r.includes(q));
    // Searching must surface matches even when the group was collapsed.
    const isOpen = !!open[g.id] || (q.length > 0 && roads.length > 0);
    const allSelected = roads.length > 0 && roads.every((r) => selected.has(r));
    const body = isOpen
      ? `<div class="iuPdFeedRoadGroup__body">` +
        `<div class="iuPdFeedQuickActs">` +
        `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--sm" data-act="feed-roads-all" data-group="${esc(
          g.id
        )}">${allSelected ? "Zrušit vše" : "Vybrat vše"}</button>` +
        `</div>` +
        (roads.length
          ? roads
              .slice(0, 400)
              .map((r) => checkItem("feed-road-toggle", r, r, selected.has(r), ` data-group="${esc(g.id)}"`))
              .join("")
          : `<p class="iuPdFeedHint">Žádné komunikace v aktuálních datech.</p>`) +
        (roads.length > 400
          ? `<p class="iuPdFeedHint">Zobrazeno 400 z ${roads.length}. Upřesněte hledání.</p>`
          : "") +
        `</div>`
      : "";
    return (
      `<div class="iuPdFeedRoadGroup" data-road-group="${esc(g.id)}">` +
      `<button type="button" class="iuPdFeedRoadGroup__toggle" data-act="feed-road-group" data-group="${esc(
        g.id
      )}" aria-expanded="${isOpen ? "true" : "false"}">` +
      `<span>${esc(g.label)}</span>` +
      `<span class="iuPdFeedAcc__chev" aria-hidden="true"></span>` +
      `</button>` +
      body +
      `</div>`
    );
  }).join("");
  return (
    `<div class="iuPdFeedRoads">` +
    `<input type="search" class="iuPdFeedSearch" placeholder="Hledat silnici…" value="${esc(
      roadQuery || ""
    )}" data-act="feed-road-q" autocomplete="off" />` +
    groups +
    `</div>`
  );
}

function eventsBodyHtml(traffic) {
  const selected = new Set(traffic.eventCategories || []);
  const isNone = selected.size === 1 && selected.has("__none__");
  const isAll = !selected.size;
  return (
    `<div class="iuPdFeedEvents">` +
    `<div class="iuPdFeedQuickActs">` +
    `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--sm" data-act="feed-events-all">${
      isAll ? "Zrušit vše" : "Vybrat vše"
    }</button>` +
    `</div>` +
    EVENT_USER_CATEGORIES.map((c) =>
      checkItem("feed-event-toggle", c.id, c.label, isAll || (!isNone && selected.has(c.id)))
    ).join("") +
    `</div>`
  );
}

function parkingBodyHtml(traffic, openParkingCities) {
  const enabled = !!traffic.parkingEnabled;
  const selected = new Set(traffic.parkingIds || []);
  const cities = parkingCitiesFromRegistry();
  const open = openParkingCities || {};
  const cityBlocks = cities
    .map((city) => {
      const isOpen = !!open[city.city];
      const lotIds = city.lots.map((l) => l.id);
      const allOn = lotIds.length > 0 && lotIds.every((id) => selected.has(id));
      const body = isOpen
        ? `<div class="iuPdFeedParkCity__body">` +
          `<div class="iuPdFeedQuickActs">` +
          `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--sm" data-act="feed-park-all" data-city="${esc(
            city.city
          )}">${allOn ? "Zrušit všechna" : "Vybrat všechna"}</button>` +
          `</div>` +
          city.lots
            .map((l) => checkItem("feed-park-toggle", l.id, l.name, selected.has(l.id), ` data-city="${esc(city.city)}"`))
            .join("") +
          `</div>`
        : "";
      return (
        `<div class="iuPdFeedParkCity">` +
        `<button type="button" class="iuPdFeedParkCity__toggle" data-act="feed-park-city" data-city="${esc(
          city.city
        )}" aria-expanded="${isOpen ? "true" : "false"}">` +
        `<span>${esc(city.city)}</span>` +
        `<span class="iuPdFeedMuted">${city.lots.length}</span>` +
        `<span class="iuPdFeedAcc__chev" aria-hidden="true"></span>` +
        `</button>` +
        body +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="iuPdFeedParking">` +
    checkItem("feed-park-enable", "1", "Zobrazovat parkoviště", enabled) +
    (enabled
      ? cityBlocks || `<p class="iuPdFeedHint">Žádná podporovaná parkoviště v registru.</p>`
      : `<p class="iuPdFeedHint">Zapněte zobrazení parkovišť pro výběr měst a lokalit.</p>`) +
    `</div>`
  );
}

/**
 * Traffic detail settings (4 accordions).
 */
export function trafficDetailSettingsHtml(ctx) {
  const {
    draft,
    openAcc,
    krajeList,
    cityQuery,
    citySuggest,
    cityLimitMsg,
    roadQuery,
    openRoadGroups,
    openParkingCities,
    trafficItemsForCatalog,
  } = ctx;
  const ff = getDraftFeedFilter(draft);
  const traffic = ff.traffic || defaultTrafficFilter();
  const catalog = buildRoadCatalogFromTrafficItems(trafficItemsForCatalog || []);
  const selCities = (traffic.localities || []).filter((l) => l.level === "mesto");
  const areaBody = localityPickerHtml({
    localities: traffic.localities,
    krajeList,
    okresyMap: null,
    includeOkresy: false,
    cityQuery,
    citySuggest,
    selCities,
    cityLimitMsg,
  });
  return (
    `<div class="iuPdFeedDetail iuPdFeedDetail--traffic" data-iu-feed-detail="traffic">` +
    accordionSection("area", "📍 Oblast", summarizeLocalities(traffic.localities), openAcc === "area", areaBody) +
    accordionSection(
      "roads",
      "🛣️ Silnice",
      summarizeRoads(traffic.roads),
      openAcc === "roads",
      roadsBodyHtml(traffic, catalog, roadQuery, openRoadGroups)
    ) +
    accordionSection(
      "events",
      "⚠️ Události",
      summarizeEventCategories(traffic.eventCategories),
      openAcc === "events",
      eventsBodyHtml(traffic)
    ) +
    accordionSection(
      "parking",
      "🅿️ Parkoviště",
      summarizeParking(traffic),
      openAcc === "parking",
      parkingBodyHtml(traffic, openParkingCities)
    ) +
    `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block iuPdFeedReset" data-act="feed-reset-traffic">Obnovit výchozí nastavení</button>` +
    `</div>`
  );
}

/**
 * ČHMÚ detail — locality only (with okresy).
 */
export function chmuDetailSettingsHtml(ctx) {
  const { draft, krajeList, okresyMap, cityQuery, citySuggest, cityLimitMsg, openAcc } = ctx;
  const ff = getDraftFeedFilter(draft);
  const chmu = ff.chmu || defaultChmuFilter();
  const selCities = (chmu.localities || []).filter((l) => l.level === "mesto");
  const areaBody = localityPickerHtml({
    localities: chmu.localities,
    krajeList,
    okresyMap,
    includeOkresy: true,
    cityQuery,
    citySuggest,
    selCities,
    cityLimitMsg,
  });
  return (
    `<div class="iuPdFeedDetail iuPdFeedDetail--chmu" data-iu-feed-detail="chmu">` +
    accordionSection("area", "📍 Oblast", summarizeLocalities(chmu.localities), openAcc !== "none", areaBody) +
    `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block iuPdFeedReset" data-act="feed-reset-chmu">Obnovit výchozí nastavení</button>` +
    `</div>`
  );
}

export function quickViewBarHtml(ff, quickView) {
  const trafficOn = ff.trafficEnabled !== false;
  const chmuOn = ff.chmuEnabled !== false;
  const q = quickView === "traffic" || quickView === "chmu" ? quickView : "all";
  const btn = (id, label, cls, disabled) =>
    `<button type="button" class="iuPdQuickView__btn iuPdQuickView__btn--${esc(cls)}${
      q === id ? " is-on" : ""
    }" data-act="feed-quick-view" data-view="${esc(id)}"${disabled ? " disabled aria-disabled=\"true\"" : ""}>${esc(
      label
    )}</button>`;
  return (
    `<div class="iuPdQuickView" data-iu-feed-quick="1" role="toolbar" aria-label="Rychlý pohled feedu">` +
    btn("all", "Vše", "all", false) +
    btn("traffic", "Doprava", "traffic", !trafficOn) +
    btn("chmu", "ČHMÚ", "chmu", !chmuOn) +
    `</div>`
  );
}

export function emptyFeedStateHtml() {
  return (
    `<div class="iuPdFeedEmpty" data-iu-feed-empty="1" role="status">` +
    `<p class="iuPdFeedEmpty__title">Pro toto nastavení momentálně nemáme žádné události.</p>` +
    `<button type="button" class="iuPdBtn iuPdBtn--primary" data-act="open-settings">Upravit filtry</button>` +
    `</div>`
  );
}

/** Mutators used by event wiring */
export function toggleLocCr(ff, kind) {
  const target = kind === "chmu" ? ff.chmu : ff.traffic;
  target.localities = [];
}

export function toggleLocKraj(ff, kind, krajName, on) {
  const target = kind === "chmu" ? ff.chmu : ff.traffic;
  const name = String(krajName || "");
  let locs = (target.localities || []).filter((l) => !(l.level === "kraj" && l.name === name));
  // Selecting a kraj leaves Celá ČR
  if (on) locs.push({ name, level: "kraj", id: "", orpCode: "" });
  // Drop okresy that no longer belong when kraje change — caller may prune
  target.localities = locs;
}

export function toggleLocOkres(ff, okresName, on) {
  const name = String(okresName || "");
  let locs = (ff.chmu.localities || []).filter((l) => !(l.level === "okres" && l.name === name));
  if (on) locs.push({ name, level: "okres", id: "", orpCode: "" });
  ff.chmu.localities = locs;
}

export function addCityLocality(ff, kind, city, maxCities) {
  const target = kind === "chmu" ? ff.chmu : ff.traffic;
  const locs = Array.isArray(target.localities) ? target.localities.slice() : [];
  const cities = locs.filter((l) => l.level === "mesto");
  if (cities.length >= maxCities) return { ok: false, reason: "limit" };
  if (cities.some((c) => c.name === city.name && String(c.id || "") === String(city.id || ""))) {
    return { ok: true };
  }
  locs.push({
    name: city.name,
    level: "mesto",
    id: city.id || "",
    orpCode: city.orpCode || "",
  });
  target.localities = locs;
  return { ok: true };
}

export function removeCityLocality(ff, kind, name, id) {
  const target = kind === "chmu" ? ff.chmu : ff.traffic;
  target.localities = (target.localities || []).filter(
    (l) => !(l.level === "mesto" && l.name === name && String(l.id || "") === String(id || ""))
  );
}

export function toggleRoad(ff, road, on) {
  const r = String(road || "").toUpperCase();
  let roads = (ff.traffic.roads || []).map((x) => String(x).toUpperCase());
  roads = roads.filter((x) => x !== r);
  if (on) roads.push(r);
  ff.traffic.roads = roads;
}

export function setRoadsGroup(ff, roadsInGroup, selectAll) {
  const set = new Set((ff.traffic.roads || []).map((x) => String(x).toUpperCase()));
  for (const r of roadsInGroup || []) {
    const u = String(r).toUpperCase();
    if (selectAll) set.add(u);
    else set.delete(u);
  }
  ff.traffic.roads = Array.from(set);
}

export function toggleEventCategory(ff, id, on) {
  let cats = (ff.traffic.eventCategories || []).slice();
  if (cats.length === 1 && cats[0] === "__none__") {
    cats = on ? [id] : ["__none__"];
    ff.traffic.eventCategories = cats;
    return;
  }
  // Transition from "empty = all": first uncheck materializes full set minus one.
  if (!cats.length) {
    cats = EVENT_USER_CATEGORIES.map((c) => c.id);
  }
  cats = cats.filter((c) => c !== id && c !== "__none__");
  if (on) cats.push(id);
  if (cats.length === EVENT_USER_CATEGORIES.length) cats = [];
  if (!cats.length && !on) cats = ["__none__"];
  ff.traffic.eventCategories = cats;
}

export function setAllEventCategories(ff, selectAll) {
  if (selectAll) ff.traffic.eventCategories = [];
  else ff.traffic.eventCategories = ["__none__"];
}

export function toggleParkingEnabled(ff, on) {
  ff.traffic.parkingEnabled = !!on;
  if (!on) {
    /* keep parkingIds for restore when re-enabled */
  }
}

export function toggleParkingId(ff, id, on) {
  let ids = (ff.traffic.parkingIds || []).slice();
  ids = ids.filter((x) => x !== id);
  if (on) ids.push(id);
  ff.traffic.parkingIds = ids;
  if (ids.length) ff.traffic.parkingEnabled = true;
}

export function setParkingCity(ff, cityLots, selectAll) {
  const lotIds = (cityLots || []).map((l) => l.id);
  let ids = new Set(ff.traffic.parkingIds || []);
  for (const id of lotIds) {
    if (selectAll) ids.add(id);
    else ids.delete(id);
  }
  ff.traffic.parkingIds = Array.from(ids);
  if (ff.traffic.parkingIds.length) ff.traffic.parkingEnabled = true;
}

export function resetTraffic(ff) {
  ff.traffic = defaultTrafficFilter();
}

export function resetChmu(ff) {
  ff.chmu = defaultChmuFilter();
}
