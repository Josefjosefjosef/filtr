/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
/* iu-affiliate-catalog-bust: cj-phase3z-v16-public-swap-2026-11-01 */
(function iuAffiliateCatalog() {
  "use strict";

  if (window.__iuAffiliateCatalogBooted) return;
  window.__iuAffiliateCatalogBooted = true;

  var IU_AFFILIATE_DISCLOSURE_TEXT =
    "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";

  function renderAffiliateDisclosure(el) {
    if (!el) return;
    el.innerHTML = escapeHtml(IU_AFFILIATE_DISCLOSURE_TEXT);
  }

  function affItem(title, slug) {
    return {
      title: title,
      url: "#affiliate-placeholder-" + slug,
      affiliateUrlReady: false,
    };
  }

  /* Ready partner with live CJ / affiliate tracking URL (text-only chip). */
  function affPartner(title, url, advertiserId) {
    return {
      title: title,
      url: url,
      affiliateUrlReady: true,
      advertiserId: advertiserId || null,
    };
  }

  function affSeo(title, paragraphs) {
    return {
      title: title,
      paragraphs: paragraphs,
    };
  }

  function getAffCssColor(catId) {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue("--iuAff-" + catId)
        .trim();
      return v || "";
    } catch (_) {
      return "";
    }
  }

  var IU_AFFILIATE_SEO = {
    "aff-cestovni-kancelare": affSeo(
      "Cestovní kanceláře – odkazy na vybrané externí služby",
      [
        "Sekce Cestovní kanceláře obsahuje odkazy na vybrané externí cestovní kanceláře, cestovní portály a související služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky, ceny, dostupnost, podmínky, informace o zájezdech a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-ubytovani-hotely": affSeo(
      "Ubytování a hotely – odkazy na vybrané externí služby",
      [
        "Sekce Ubytování a hotely obsahuje odkazy na vybrané externí služby pro rezervaci ubytování, hotelů a souvisejících pobytů. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-letenky": affSeo(
      "Doprava a cestování – odkazy na vybrané externí služby",
      [
        "Sekce Doprava a cestování obsahuje odkazy na vybrané externí služby související s dopravou a cestováním, například leteckou, vlakovou nebo autobusovou dopravou a další cestovní podporou. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-letenky-letecka-doprava": affSeo(
      "Letenky a letecká doprava – odkazy na vybrané externí služby",
      [
        "Sekce Letenky a letecká doprava obsahuje odkazy na vybrané externí služby pro vyhledávání a rezervaci letenek a služby související s leteckou dopravou. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-cestovni-pojisteni": affSeo(
      "Cestovní pojištění – odkazy na vybrané externí služby",
      [
        "Sekce Cestovní pojištění obsahuje odkazy na vybrané externí pojišťovny a asistenční služby související s cestováním. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Rozsah krytí, ceny, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-auto-moto": affSeo(
      "Auto a moto – odkazy na vybrané externí služby",
      [
        "Sekce Auto a moto obsahuje odkazy na vybrané externí obchody a služby se sortimentem pro automobily a motocykly. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-pneu-pneuservis": affSeo(
      "Pneu a pneuservis – odkazy na vybrané externí služby",
      [
        "Sekce Pneu a pneuservis obsahuje odkazy na vybrané externí prodejce pneumatik, pneuservisy a služby související s pneumatikami, přezutím a servisem kol. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky, rozsah poskytovaných služeb a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-pojisteni": affSeo(
      "Pojištění – odkazy na vybrané externí služby",
      [
        "Sekce Pojištění obsahuje odkazy na vybrané externí pojišťovny a srovnávací služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, rozsah krytí, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-finance": affSeo(
      "Finance – odkazy na vybrané externí služby",
      [
        "Sekce Finance obsahuje odkazy na vybrané externí finanční služby a produkty. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, podmínky, dostupnost produktů a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-energie-uspor": affSeo(
      "Energie a úspory – odkazy na vybrané externí služby",
      [
        "Sekce Energie a úspory obsahuje odkazy na vybrané externí služby a obchody související s energiemi a domácími produkty. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, tarify, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-lekarny": affSeo(
      "Lékárny – odkazy na vybrané externí služby",
      [
        "Sekce Lékárny obsahuje odkazy na vybrané externí lékárny a související obchody. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky prodeje a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-zdravi-doplnky": affSeo(
      "Zdraví a doplňky – odkazy na vybrané externí služby",
      [
        "Sekce Zdraví a doplňky obsahuje odkazy na vybrané externí obchody se sortimentem souvisejícím se zdravím a doplňky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kosmetika": affSeo(
      "Kosmetika a parfémy – odkazy na vybrané externí služby",
      [
        "Sekce Kosmetika a parfémy obsahuje odkazy na vybrané externí obchody s kosmetikou a parfémy. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-drogerie": affSeo(
      "Drogerie – odkazy na vybrané externí služby",
      [
        "Sekce Drogerie obsahuje odkazy na vybrané externí drogerie a související obchody. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-moda": affSeo(
      "Móda a doplňky – odkazy na vybrané externí služby",
      [
        "Sekce Móda a doplňky obsahuje odkazy na vybrané externí obchody s oblečením, módou a souvisejícími doplňky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-boty": affSeo(
      "Boty a tenisky – odkazy na vybrané externí služby",
      [
        "Sekce Boty a tenisky obsahuje odkazy na vybrané externí obchody s obuví. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-deti-hracky": affSeo(
      "Děti a hračky – odkazy na vybrané externí služby",
      [
        "Sekce Děti a hračky obsahuje odkazy na vybrané externí obchody se sortimentem pro děti a hračkami. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-sportovni-obleceni": affSeo(
      "Sportovní oblečení – odkazy na vybrané externí služby",
      [
        "Sekce Sportovní oblečení obsahuje odkazy na vybrané externí obchody se sportovním oblečením. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-sport-outdoor": affSeo(
      "Sport a outdoor – odkazy na vybrané externí služby",
      [
        "Sekce Sport a outdoor obsahuje odkazy na vybrané externí obchody se sportovním a outdoorovým vybavením. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-dum-zahrada": affSeo(
      "Dům a zahrada – odkazy na vybrané externí služby",
      [
        "Sekce Dům a zahrada obsahuje odkazy na vybrané externí obchody se sortimentem pro dům, zahradu a hobby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-nabytek": affSeo(
      "Bydlení a vybavení – odkazy na vybrané externí služby",
      [
        "Sekce Bydlení a vybavení obsahuje odkazy na vybrané externí obchody s vybavením bydlení a interiéru. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kuchyn": affSeo(
      "Kuchyně a domácnost – odkazy na vybrané externí služby",
      [
        "Sekce Kuchyně a domácnost obsahuje odkazy na vybrané externí obchody s vybavením kuchyně a domácnosti. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-elektro": affSeo(
      "Elektro a chytrá domácnost – odkazy na vybrané externí služby",
      [
        "Sekce Elektro a chytrá domácnost obsahuje odkazy na vybrané externí obchody s elektronikou a produkty pro domácnost. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-mobily": affSeo(
      "Mobily a příslušenství – odkazy na vybrané externí služby",
      [
        "Sekce Mobily a příslušenství obsahuje odkazy na vybrané externí obchody s telefony a příslušenstvím. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-software": affSeo(
      "Software a bezpečnost – odkazy na vybrané externí služby",
      [
        "Sekce Software a bezpečnost obsahuje odkazy na vybrané externí softwarové a bezpečnostní služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-knihy": affSeo(
      "Knihy, hudba a hry – odkazy na vybrané externí služby",
      [
        "Sekce Knihy, hudba a hry obsahuje odkazy na vybrané externí obchody a služby se sortimentem knih, hudby a her. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-jidlo": affSeo(
      "Jídlo a potraviny – odkazy na vybrané externí služby",
      [
        "Sekce Jídlo a potraviny obsahuje odkazy na vybrané externí obchody a služby s potravinami. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-zvirata": affSeo(
      "Zvířata a chovatelství – odkazy na vybrané externí služby",
      [
        "Sekce Zvířata a chovatelství obsahuje odkazy na vybrané externí obchody se sortimentem pro domácí mazlíčky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kvetiny-darky": affSeo(
      "Květiny a dárky – odkazy na vybrané externí služby",
      [
        "Sekce Květiny a dárky obsahuje odkazy na vybrané externí obchody s květinami a dárky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-sperky-hodinky": affSeo(
      "Šperky a hodinky – odkazy na vybrané externí služby",
      [
        "Sekce Šperky a hodinky obsahuje odkazy na vybrané externí obchody se šperky a hodinkami. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-tv-streamovani": affSeo(
      "TV a streamování – odkazy na vybrané externí služby",
      [
        "Sekce TV a streamování obsahuje odkazy na vybrané externí služby televizního a streamovacího obsahu. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-dilna-naradi": affSeo(
      "Dílna a nářadí – odkazy na vybrané externí služby",
      [
        "Sekce Dílna a nářadí obsahuje odkazy na vybrané externí obchody s nářadím a vybavením dílny. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-inzerce-bazary": affSeo(
      "Inzerce a bazary – odkazy na vybrané externí služby",
      [
        "Sekce Inzerce a bazary obsahuje odkazy na vybrané externí inzertní portály, bazary, online tržiště a související služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky, ceny, dostupnost, podmínky, informace o nabízeném zboží a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-realitni-kancelare": affSeo(
      "Realitní kanceláře – odkazy na vybrané externí služby",
      [
        "Sekce Realitní kanceláře obsahuje odkazy na vybrané externí realitní kanceláře a společnosti poskytující realitní služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky nemovitostí, ceny, dostupnost, podmínky a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-reality-nemovitosti": affSeo(
      "Reality a nemovitosti – odkazy na vybrané externí služby",
      [
        "Sekce Reality a nemovitosti obsahuje odkazy na vybrané externí realitní portály a služby související s nabídkou, prodejem a pronájmem nemovitostí. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky nemovitostí, ceny, dostupnost, podmínky a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kancelarske-potreby": affSeo(
      "Kancelářské potřeby a vybavení – odkazy na vybrané externí služby",
      [
        "Sekce Kancelářské potřeby a vybavení obsahuje odkazy na vybrané externí obchody a služby zaměřené na kancelářské potřeby a vybavení. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky, ceny, dostupnost, podmínky, informace o produktech a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
  };

  var IU_AFFILIATE_CATALOG = [
    {
      id: "aff-cestovni-kancelare",
      title: "Cestovní kanceláře",
      icon: "iu-aff-suitcase",
      description: "Odkazy na vybrané cestovní kanceláře a služby související s cestováním.",
      items: [
        affPartner("Blue-style.cz", "https://www.kqzyfj.com/click-101883843-14358779-1706860695000", "5605390"),
        affPartner("Cestovná kancelária DAKA.sk", "https://www.anrdoezrs.net/click-101883843-13149000-1774647386000", "5006846"),
        affPartner("Čedok.cz", "https://www.anrdoezrs.net/click-101883843-15686662-1764016300000", "6179554"),
        affPartner("Eximtours.cz", "https://www.anrdoezrs.net/click-101883843-15043859-1707862333000", "5906045"),
        affPartner("Svelt World", "https://www.kqzyfj.com/click-101883843-17323349-1787168356000", "7995512"),
        affPartner("Tui.cz", "https://www.dpbolvw.net/click-101883843-15704921-1708047255000", "6785595")
      ],
    },
    {
      id: "aff-ubytovani-hotely",
      title: "Ubytování a hotely",
      icon: "iu-aff-hotel",
      description: "Odkazy na vybrané služby pro ubytování a hotely.",
      items: [
        affPartner("Booking.com", "https://www.anrdoezrs.net/click-101883843-13386171-1779903990000", "5096493"),
        affPartner("Spa.cz", "https://www.kqzyfj.com/click-101883843-14446400-1732816773000", "5525941")
      ],
    },
    {
      id: "aff-letenky",
      title: "Doprava a cestování",
      icon: "iu-aff-transport",
      description: "Odkazy na vybrané služby související s dopravou a cestováním.",
      items: [
        affPartner("Leo Express Europe", "https://www.kqzyfj.com/click-101883843-15237230-1753820095000", "6130482")
      ],
    },
    {
      id: "aff-letenky-letecka-doprava",
      title: "Letenky a letecká doprava",
      icon: "iu-aff-plane",
      description: "Odkazy na vybrané služby pro letenky a leteckou dopravu.",
      items: [
        affPartner("Arangrant", "https://www.kqzyfj.com/click-101883843-17039663-1780544814000", "7226122"),
        affPartner("Cheapvuelos", "https://www.dpbolvw.net/click-101883843-17323048-1786578401000", "7947783"),
        affPartner("Skytours US", "https://www.jdoqocy.com/click-101883843-10681040-1529704129000", "2709631")
      ],
    },
    {
      id: "aff-cestovni-pojisteni",
      title: "Cestovní pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané služby cestovního pojištění.",
      items: [
        affPartner("Klik.cz", "https://www.jdoqocy.com/click-101883843-15024026-1708048643000", "5871720")
      ],
    },
    {
      id: "aff-auto-moto",
      title: "Auto a moto",
      icon: "iu-aff-car",
      description: "Odkazy na vybrané obchody a služby v kategorii auto a moto.",
      items: [
        affPartner("Ahifi", "https://www.kqzyfj.com/click-101883843-17006948-1751400354000", "6492736"),
        affPartner("Autohotarek.cz", "https://www.anrdoezrs.net/click-101883843-15862733-1721400970000", "7084105"),
        affPartner("Mojedilna.cz", "https://www.kqzyfj.com/click-101883843-14310928-1708045944000", "5476562")
      ],
    },
    {
      id: "aff-pneu-pneuservis",
      title: "Pneu a pneuservis",
      icon: "iu-aff-wheel",
      description:
        "Odkazy na vybrané prodejce pneumatik, pneuservisy a související služby.",
      items: [
        affPartner("Bestdrive.cz", "https://www.jdoqocy.com/click-101883843-17106105-1752508136000", "7449050")
      ],
    },
    {
      id: "aff-pojisteni",
      title: "Pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané pojišťovny a srovnávací služby.",
      items: [
        affPartner("AXA ASSISTANCE - CZ", "https://www.kqzyfj.com/click-101883843-17247087-1784041965000", "4697950"),
        affPartner("Direct.cz", "https://www.tkqlhce.com/click-101883843-14568221-1780341017000", "5812291"),
        affPartner("Ergo-cestovni.cz", "https://www.tkqlhce.com/click-101883843-17269644-1791921512000", "6767085"),
        affPartner("GeneraliCeska.cz", "https://www.anrdoezrs.net/click-101883843-13930623-1750961786000", "4711521"),
        affPartner("Kalkulator.cz", "https://www.kqzyfj.com/click-101883843-15616419-1707856260000", "6610500")
      ],
    },
    {
      id: "aff-finance",
      title: "Finance",
      icon: "iu-finance",
      description: "Odkazy na vybrané externí finanční služby.",
      items: [
      ],
    },
    {
      id: "aff-energie-uspor",
      title: "Energie a úspory",
      icon: "iu-aff-bulb",
      description: "Odkazy na vybrané služby a obchody související s energiemi a úsporami.",
      items: [
      ],
    },
    {
      id: "aff-lekarny",
      title: "Lékárny",
      icon: "iu-aff-cross",
      description: "Odkazy na vybrané externí lékárny a související obchody.",
      items: [
        affPartner("Dr.Max.SK", "https://www.anrdoezrs.net/click-101883843-13434843-1774988543000", "5006891"),
        affPartner("DRMAX.CZ", "https://www.jdoqocy.com/click-101883843-12923219-1774988131000", "4883722"),
        affPartner("GSKlub.cz", "https://www.dpbolvw.net/click-101883843-13452080-1708047941000", "5146426"),
        affPartner("Lekarna.cz", "https://www.dpbolvw.net/click-101883843-13459513-1706859530000", "5154182"),
        affPartner("Lekarnalemon.cz", "https://www.tkqlhce.com/click-101883843-14563148-1734715384000", "5842597"),
        affPartner("Mojelekarna.cz", "https://www.kqzyfj.com/click-101883843-15530070-1721681605000", "6466592")
      ],
    },
    {
      id: "aff-zdravi-doplnky",
      title: "Zdraví a doplňky",
      icon: "iu-health",
      description: "Odkazy na vybrané obchody se sortimentem zdraví a doplňků.",
      items: [
        affPartner("Amix-store / Meliora CZ", "https://www.anrdoezrs.net/click-101883843-14545972-1774651336000", "5706839"),
        affPartner("Bodyworld Europe", "https://www.dpbolvw.net/click-101883843-14524963-1708047796000", "5701422"),
        affPartner("Brainmarket Europe", "https://www.tkqlhce.com/click-101883843-17147331-1760379720000", "7474250"),
        affPartner("EZshop", "https://www.anrdoezrs.net/click-101883843-15162217-1707854049000", "5744714"),
        affPartner("Klubzdravi.cz", "https://www.anrdoezrs.net/click-101883843-13884010-1682721776000", "5292177"),
        affPartner("Mentislab.cz", "https://www.jdoqocy.com/click-101883843-13341068-1707853960000", "5096017"),
        affPartner("Nature's Finest", "https://www.anrdoezrs.net/click-101883843-17098946-1749140722000", "5554901"),
        affPartner("Nazuby.cz", "https://www.tkqlhce.com/click-101883843-11883392-1770356896000", "4322332"),
        affPartner("Rehabilitacnipomucky./pl", "https://www.tkqlhce.com/click-101883843-15421726-1707866032000", "6294181"),
        affPartner("Sensilab Europe", "https://www.dpbolvw.net/click-101883843-17092109-1782253131000", "5408233"),
        affPartner("Unizdrav", "https://www.kqzyfj.com/click-101883843-14419097-1708047624000", "5654758"),
        affPartner("Yummybox.cz", "https://www.dpbolvw.net/click-101883843-17298730-1781029378000", "7899391")
      ],
    },
    {
      id: "aff-kosmetika",
      title: "Kosmetika a parfémy",
      icon: "iu-aff-perfume",
      description: "Odkazy na vybrané obchody s kosmetikou a parfémy.",
      items: [
        affPartner("Brasty.cz", "https://www.jdoqocy.com/click-101883843-14095529-1706860572000", "5478796"),
        affPartner("Byrokko World", "https://www.kqzyfj.com/click-101883843-15885523-1725298289000", "7133039"),
        affPartner("Dedra /pl", "https://www.tkqlhce.com/click-101883843-14556169-1731604681000", "5823422"),
        affPartner("Dermacol", "https://www.jdoqocy.com/click-101883843-17173455-1763662612000", "7702047"),
        affPartner("Dermalogica.cz", "https://www.anrdoezrs.net/click-101883843-13971612-1701970307000", "5381657"),
        affPartner("FANN.CZ", "https://www.kqzyfj.com/click-101883843-12923225-1708048225000", "4904877"),
        affPartner("Foreo", "https://www.tkqlhce.com/click-101883843-17250301-1789489845000", "5755636"),
        affPartner("Nefertitis.cz", "https://www.jdoqocy.com/click-101883843-15064659-1708047767000", "5894154"),
        affPartner("Salononline.cz", "https://www.anrdoezrs.net/click-101883843-14099303-1707242734000", "5482931"),
        affPartner("SEPHORA.cz", "https://www.tkqlhce.com/click-101883843-13212014-1737590189000", "5047092"),
        affPartner("SvetKadernictvi.cz / SvetKadernictva.sk", "https://www.dpbolvw.net/click-101883843-14386407-1708047783000", "5611262"),
        affPartner("Tierraverde", "https://www.anrdoezrs.net/click-101883843-17313396-1782831175000", "7612998"),
        affPartner("Yves-rocher.cz", "https://www.tkqlhce.com/click-101883843-13407784-1698794483000", "5124968")
      ],
    },
    {
      id: "aff-drogerie",
      title: "Drogerie",
      icon: "iu-aff-bottle",
      description: "Odkazy na vybrané drogerie a související obchody.",
      items: [
        affPartner("Rossmann.cz", "https://www.tkqlhce.com/click-101883843-17236887-1769733415000", "7786972")
      ],
    },
    {
      id: "aff-moda",
      title: "Móda a doplňky",
      icon: "iu-aff-shirt",
      description: "Odkazy na vybrané obchody s módou, oblečením a doplňky.",
      items: [
        affPartner("Answear.cz", "https://www.anrdoezrs.net/click-101883843-11845757-1737587799000", "4327375"),
        affPartner("Demix.cz", "https://www.kqzyfj.com/click-101883843-15202259-1779894736000", "6044117"),
        affPartner("Ecomodi", "https://www.jdoqocy.com/click-101883843-15216933-1770141421000", "6065327"),
        affPartner("Exejeans.cz", "https://www.jdoqocy.com/click-101883843-15749236-1708109190000", "6393044"),
        affPartner("Factcool Europe", "https://www.jdoqocy.com/click-101883843-14017743-1696616637000", "5402439"),
        affPartner("GANT.CZ", "https://www.dpbolvw.net/click-101883843-13057399-1770347530000", "4978487"),
        affPartner("GUNSANDTUXEDOS.COM/CS", "https://www.tkqlhce.com/click-101883843-13219632-1527185677000", "5043902"),
        affPartner("Horsefeathers Europe", "https://www.jdoqocy.com/click-101883843-15064844-1708047670000", "5780936"),
        affPartner("Imoda.sk", "https://www.tkqlhce.com/click-101883843-15484835-1708044757000", "6306286"),
        affPartner("Instamo.cz", "https://www.jdoqocy.com/click-101883843-15753113-1708627055000", "6754118"),
        affPartner("Jeans-shop", "https://www.kqzyfj.com/click-101883843-15377778-1708045809000", "6258510"),
        affPartner("Kabea", "https://www.anrdoezrs.net/click-101883843-13872206-1778601548000", "5316217"),
        affPartner("Kings Camo", "https://www.dpbolvw.net/click-101883843-15774549-1768626000000", "7016567"),
        affPartner("Lelosi Europe", "https://www.tkqlhce.com/click-101883843-15356578-1708044549000", "6256015"),
        affPartner("Meatfly.cz", "https://www.dpbolvw.net/click-101883843-15065877-1729192249000", "5590289"),
        affPartner("T-shock.eu", "https://www.anrdoezrs.net/click-101883843-13457304-1734051759000", "5147910"),
        affPartner("Trenyrkarna Europe", "https://www.tkqlhce.com/click-101883843-15185048-1645808097000", "5938081"),
        affPartner("VIP-pradlo.cz", "https://www.tkqlhce.com/click-101883843-15807129-1717766021000", "7019151"),
        affPartner("Vivantis.cz", "https://www.dpbolvw.net/click-101883843-12411812-1787060247000", "4384608"),
        affPartner("Warsawsneakerstore.com", "https://www.kqzyfj.com/click-101883843-15731087-1724433362000", "6796197"),
        affPartner("WearMedicine CZ", "https://www.tkqlhce.com/click-101883843-17213743-1782755167000", "7726276")
      ],
    },
    {
      id: "aff-boty",
      title: "Boty a tenisky",
      icon: "iu-aff-shoe",
      description: "Odkazy na vybrané obchody s obuví.",
      items: [
        affPartner("Bohempia Global", "https://www.anrdoezrs.net/click-101883843-15228136-1747246094000", "5992572"),
        affPartner("REJNOKOBUV.CZ", "https://www.jdoqocy.com/click-101883843-12939731-1706862710000", "4905039"),
        affPartner("Shapenbarefoot.com", "https://www.jdoqocy.com/click-101883843-15746678-1772583349000", "6659563"),
        affPartner("Skinners Europe", "https://www.dpbolvw.net/click-101883843-15759555-1743699178000", "6892836"),
        affPartner("Zdrava-obuv-eshop.cz", "https://www.kqzyfj.com/click-101883843-17282656-1778510217000", "7923950")
      ],
    },
    {
      id: "aff-deti-hracky",
      title: "Děti a hračky",
      icon: "iu-aff-blocks",
      description: "Odkazy na vybrané obchody se sortimentem pro děti a hračkami.",
      items: [
        affPartner("4kids.cz", "https://www.kqzyfj.com/click-101883843-13469142-1708047875000", "5153670"),
        affPartner("Activa CZ_Bibelot", "https://www.dpbolvw.net/click-101883843-15544489-1708048268000", "5260576"),
        affPartner("BAMBULE.cz", "https://www.dpbolvw.net/click-101883843-12990634-1706861500000", "4949011"),
        affPartner("Bruderland Europe", "https://www.jdoqocy.com/click-101883843-17073660-1746481013000", "7424533"),
        affPartner("Feedo.cz", "https://www.anrdoezrs.net/click-101883843-12984087-1708046991000", "4901154"),
        affPartner("hero-wars.com", "https://www.dpbolvw.net/click-101883843-17147755-1760460640000", "7520433"),
        affPartner("Novakid INT", "https://www.jdoqocy.com/click-101883843-14509925-1756149393000", "5578976"),
        affPartner("Rajhraciek Europe", "https://www.anrdoezrs.net/click-101883843-17015011-1751327102000", "7260722")
      ],
    },
    {
      id: "aff-sportovni-obleceni",
      title: "Sportovní oblečení",
      icon: "iu-aff-jersey",
      description: "Odkazy na vybrané obchody se sportovním oblečením.",
      items: [
      ],
    },
    {
      id: "aff-sport-outdoor",
      title: "Sport a outdoor",
      icon: "iu-aff-tent",
      description: "Odkazy na vybrané obchody se sportovním a outdoorovým vybavením.",
      items: [
        affPartner("Bauerhockey.cz/Kappa-sport.cz", "https://www.dpbolvw.net/click-101883843-15538930-1781558849000", "5725783"),
        affPartner("Bezvasport", "https://www.kqzyfj.com/click-101883843-14023984-1728929647000", "5277391"),
        affPartner("Bushman CZ SK EU", "https://www.tkqlhce.com/click-101883843-14029485-1708045567000", "5401824"),
        affPartner("DECATHLON.CZ", "https://www.dpbolvw.net/click-101883843-15698594-1736886557000", "5021212"),
        affPartner("E-armyshop.cz", "https://www.kqzyfj.com/click-101883843-17291498-1779821324000", "7917498"),
        affPartner("E-sportshop", "https://www.kqzyfj.com/click-101883843-15473642-1731086967000", "6215286"),
        affPartner("Hs-sport.cz", "https://www.tkqlhce.com/click-101883843-14353861-1706862369000", "5603344"),
        affPartner("Husky", "https://www.dpbolvw.net/click-101883843-14024803-1710438744000", "5404810"),
        affPartner("inSPORTline.cz", "https://www.tkqlhce.com/click-101883843-12613631-1707852510000", "4754417"),
        affPartner("PARYS.CZ", "https://www.jdoqocy.com/click-101883843-12923227-1706866900000", "4887633"),
        affPartner("Sportisimo Europe", "https://www.dpbolvw.net/click-101883843-13592781-1770418717000", "5177969"),
        affPartner("Urbane.cz", "https://www.tkqlhce.com/click-101883843-15359455-1708046402000", "6127623"),
        affPartner("Velocity Outdoor – Ravin/CenterPoint/Valhalla", "https://www.jdoqocy.com/click-101883843-15747470-1768609346000", "6038648")
      ],
    },
    {
      id: "aff-dum-zahrada",
      title: "Dům a zahrada",
      icon: "iu-home-hobby",
      description: "Odkazy na vybrané obchody pro dům, zahradu a hobby.",
      items: [
        affPartner("Butlers.cz", "https://www.kqzyfj.com/click-101883843-12070030-1606779891000", "4432968"),
        affPartner("DECODOMA.CZ", "https://www.anrdoezrs.net/click-101883843-12923226-1706861546000", "4882378"),
        affPartner("Dedoma.sk", "https://www.anrdoezrs.net/click-101883843-13219578-1706861751000", "5000412"),
        affPartner("Dopplershop", "https://www.jdoqocy.com/click-101883843-15319222-1707865993000", "6065245"),
        affPartner("Dormeo Europe", "https://www.dpbolvw.net/click-101883843-15806382-1716393572000", "6976980"),
        affPartner("Dreamy.cz", "https://www.dpbolvw.net/click-101883843-17009200-1741815533000", "7318611"),
        affPartner("Gorenje.cz", "https://www.kqzyfj.com/click-101883843-15409173-1707853887000", "6112132"),
        affPartner("Hezkakoupelna.cz", "https://www.dpbolvw.net/click-101883843-17240342-1771265855000", "7816491"),
        affPartner("KÄRCHER.CZ", "https://www.dpbolvw.net/click-101883843-17091927-1772045401000", "4927529"),
        affPartner("Puella Europe", "https://www.jdoqocy.com/click-101883843-17203359-1764101884000", "7643241"),
        affPartner("Sanitino Europe", "https://www.jdoqocy.com/click-101883843-17007319-1738188841000", "6358042"),
        affPartner("SIKO.CZ", "https://www.jdoqocy.com/click-101883843-12948215-1707862038000", "4932883"),
        affPartner("SoftCotton Europe", "https://www.dpbolvw.net/click-101883843-17352981-1789588765000", "5005974"),
        affPartner("Vitapur Europe", "https://www.anrdoezrs.net/click-101883843-17237812-1773778341000", "6511227"),
        affPartner("Vladeko.cz", "https://www.jdoqocy.com/click-101883843-15273907-1752797996000", "5723506"),
        affPartner("Vyprodejpovleceni /RO", "https://www.tkqlhce.com/click-101883843-15247086-1708045491000", "6109393"),
        affPartner("Zahradajezek.cz/Odsuseda.sk/Jeza.hu", "https://www.kqzyfj.com/click-101883843-14047408-1707862840000", "5444910"),
        affPartner("Zepter Europe", "https://www.anrdoezrs.net/click-101883843-17074303-1771348022000", "7341377")
      ],
    },
    {
      id: "aff-nabytek",
      title: "Bydlení a vybavení",
      icon: "iu-aff-sofa",
      description: "Odkazy na vybrané obchody s vybavením bydlení a interiéru.",
      items: [
        affPartner("ASKO-NABYTEK.CZ", "https://www.dpbolvw.net/click-101883843-12920057-1707862248000", "4920521"),
        affPartner("Benlemi Europe", "https://www.anrdoezrs.net/click-101883843-15025742-1726852772000", "5870560"),
        affPartner("Decoronline Europe", "https://www.jdoqocy.com/click-101883843-13628208-1708045986000", "5217822"),
        affPartner("Diablochairs Europe", "https://www.kqzyfj.com/click-101883843-16955725-1744823065000", "7149746"),
        affPartner("Dxracer cz-sk/Kancelarskezidle.com", "https://www.kqzyfj.com/click-101883843-14303779-1707852778000", "5493238"),
        affPartner("Jan Nowak EU", "https://www.dpbolvw.net/click-101883843-17269525-1775852855000", "7859657"),
        affPartner("Kancelarskestolicky.com", "https://www.kqzyfj.com/click-101883843-14303854-1707853386000", "5493235"),
        affPartner("Nabytekpaul.cz", "https://www.tkqlhce.com/click-101883843-14307225-1706861806000", "5381727"),
        affPartner("Scandishop /ro", "https://www.kqzyfj.com/click-101883843-15041103-1708046514000", "5884820"),
        affPartner("Veneti", "https://www.anrdoezrs.net/click-101883843-17258723-1773858468000", "7793108"),
        affPartner("VidaXL", "https://www.jdoqocy.com/click-101883843-15755500-1738692224000", "5889034"),
        affPartner("XXXLutz.cz", "https://www.tkqlhce.com/click-101883843-13966880-1708051652000", "5335380")
      ],
    },
    {
      id: "aff-kuchyn",
      title: "Kuchyně a domácnost",
      icon: "iu-aff-pot",
      description: "Odkazy na vybrané obchody s vybavením kuchyně a domácnosti.",
      items: [
        affPartner("GrilyKrby.cz", "https://www.anrdoezrs.net/click-101883843-12522012-1770330601000", "4694431"),
        affPartner("Homeandcook.cz", "https://www.tkqlhce.com/click-101883843-14371269-1708047715000", "5598091"),
        affPartner("KitchenShop Europe", "https://www.tkqlhce.com/click-101883843-17094894-1749153962000", "7327751")
      ],
    },
    {
      id: "aff-elektro",
      title: "Elektro a chytrá domácnost",
      icon: "iu-aff-plug",
      description: "Odkazy na vybrané obchody s elektronikou a chytrou domácností.",
      items: [
        affPartner("Argos.cz", "https://www.tkqlhce.com/click-101883843-17366260-1792164145000", "8010554"),
        affPartner("Eshop.ledvance.cz", "https://www.jdoqocy.com/click-101883843-15607577-1707855729000", "6546769"),
        affPartner("KVelektro.cz", "https://www.jdoqocy.com/click-101883843-13812779-1708044774000", "5303370"),
        affPartner("Kytary Europe", "https://www.tkqlhce.com/click-101883843-15156146-1708044694000", "4851178"),
        affPartner("LAMAX / LAUBEN / TRUELIFE", "https://www.dpbolvw.net/click-101883843-13897306-1768946965000", "5193265"),
        affPartner("LG CZ", "https://www.tkqlhce.com/click-101883843-15861968-1731638716000", "7073996"),
        affPartner("TIPA.EU", "https://www.anrdoezrs.net/click-101883843-14049044-1708047911000", "4921612")
      ],
    },
    {
      id: "aff-mobily",
      title: "Mobily a příslušenství",
      icon: "iu-aff-phone",
      description: "Odkazy na vybrané obchody s mobily a příslušenstvím.",
      items: [
        affPartner("Tvrzenaskla/Momanio Europe", "https://www.tkqlhce.com/click-101883843-15319724-1708044873000", "6203294")
      ],
    },
    {
      id: "aff-software",
      title: "Software a bezpečnost",
      icon: "iu-aff-lock",
      description: "Odkazy na vybrané softwarové a bezpečnostní služby.",
      items: [
        affPartner("ABBYY", "https://www.anrdoezrs.net/click-101883843-14533231-1716477726000", "2624620"),
        affPartner("GearUP", "https://www.dpbolvw.net/click-101883843-17255582", "7804601"),
        affPartner("Kaspersky", "https://www.anrdoezrs.net/click-101883843-17364722-1791819181000", "5132330"),
        affPartner("Surfshark", "https://www.jdoqocy.com/click-101883843-15438560-1759355883000", "6282055")
      ],
    },
    {
      id: "aff-knihy",
      title: "Knihy, hudba a hry",
      icon: "iu-aff-book",
      description: "Odkazy na vybrané obchody s knihami, hudbou a hrami.",
      items: [
        affPartner("Gorila.sk", "https://www.kqzyfj.com/click-101883843-13785660-1708045003000", "5284767"),
        affPartner("Grada", "https://www.anrdoezrs.net/click-101883843-14036380-1741207351000", "5321357"),
        affPartner("imago.cz", "https://www.anrdoezrs.net/click-101883843-15811153-1715879081000", "6972484"),
        affPartner("KnihyDobrovsky.cz", "https://www.tkqlhce.com/click-101883843-12733240-1780500997000", "4805198"),
        affPartner("Martinus.cz", "https://www.kqzyfj.com/click-101883843-13771835-1708048047000", "5284288")
      ],
    },
    {
      id: "aff-jidlo",
      title: "Jídlo a potraviny",
      icon: "iu-aff-cart",
      description: "Odkazy na vybrané obchody a služby s potravinami.",
      items: [
        affPartner("BAMchocolate Europe", "https://www.kqzyfj.com/click-101883843-17072849-1745943392000", "7416299"),
        affPartner("Gourmetkava Europe", "https://www.anrdoezrs.net/click-101883843-13651120-1707852995000", "5234320"),
        affPartner("lidl-shop.cz", "https://www.anrdoezrs.net/click-101883843-15177844-1781719308000", "5954793"),
        affPartner("Svět Plodů", "https://www.anrdoezrs.net/click-101883843-15154809-1708047986000", "6002445"),
        affPartner("Zivina.cz", "https://www.kqzyfj.com/click-101883843-15852097-1747411822000", "5929753"),
        affPartner("Zlatezrnko", "https://www.jdoqocy.com/click-101883843-13992103-1708044856000", "5393861")
      ],
    },
    {
      id: "aff-zvirata",
      title: "Zvířata a chovatelství",
      icon: "iu-aff-paw",
      description: "Odkazy na vybrané obchody pro zvířata a chovatelství.",
      items: [
        affPartner("Reedog Europe", "https://www.dpbolvw.net/click-101883843-13902657-1746222889000", "5306925"),
        affPartner("SUPERZOO.cz", "https://www.kqzyfj.com/click-101883843-12607708-1788880684000", "4758296")
      ],
    },
    {
      id: "aff-kvetiny-darky",
      title: "Květiny a dárky",
      icon: "iu-aff-flower",
      description: "Odkazy na vybrané obchody s květinami a dárky.",
      items: [
        affPartner("Abracadabra NYC", "https://www.tkqlhce.com/click-101883843-17267156-1778559079000", "7889430"),
        affPartner("Firmanazazitky.cz", "https://www.kqzyfj.com/click-101883843-17346622-1790103147000", "7918457"),
        affPartner("Hubatacernoska.cz", "https://www.kqzyfj.com/click-101883843-15082897-1654637571000", "5950512"),
        affPartner("KvetinyExpres.cz", "https://www.dpbolvw.net/click-101883843-12081321-1665632892000", "4409645"),
        affPartner("Manboxeo /DE", "https://www.dpbolvw.net/click-101883843-17033008-1743621165000", "7401912")
      ],
    },
    {
      id: "aff-sperky-hodinky",
      title: "Šperky a hodinky",
      icon: "iu-aff-watch",
      description: "Odkazy na vybrané obchody se šperky a hodinkami.",
      items: [
        affPartner("Royalfashion.cz", "https://www.anrdoezrs.net/click-101883843-15027011-1707853835000", "5819507")
      ],
    },
    {
      id: "aff-tv-streamovani",
      title: "TV a streamování",
      icon: "iu-aff-tv",
      description: "Odkazy na vybrané televizní a streamovací služby.",
      items: [
        affPartner("DVD-premiery.cz", "https://www.jdoqocy.com/click-101883843-13452100-1623163088000", "5143409"),
        affPartner("Skylink", "https://www.anrdoezrs.net/click-101883843-15322953-1793149244000", "5395330"),
        affPartner("Supraphonline.cz", "https://www.dpbolvw.net/click-101883843-14093602-1734654962000", "5477885")
      ],
    },
    {
      id: "aff-dilna-naradi",
      title: "Dílna a nářadí",
      icon: "iu-aff-hammer",
      description: "Odkazy na vybrané obchody s nářadím a vybavením dílny.",
      items: [
        affPartner("DEK.cz", "https://www.jdoqocy.com/click-101883843-13457236-1708044985000", "5142212"),
        affPartner("Dvere-Erkado.cz", "https://www.jdoqocy.com/click-101883843-13234841-1748446701000", "5027071"),
        affPartner("Expondo GMBH", "https://www.anrdoezrs.net/click-101883843-14032356-1748654764000", "5320945"),
        affPartner("OBI CZ", "https://www.dpbolvw.net/click-101883843-15816967-1717693778000", "6857406")
      ],
    },
    {
      id: "aff-inzerce-bazary",
      title: "Inzerce a bazary",
      icon: "iu-aff-marketplace",
      description: "Odkazy na vybrané inzertní portály, bazary, online tržiště a související služby.",
      items: [
        affPartner("Allegro.cz", "https://www.dpbolvw.net/click-101883843-15528397-1706866785000", "6464420"),
        affPartner("AUKRO", "https://www.dpbolvw.net/click-101883843-13276590-1746477299000", "5078957")
      ],
    },
    {
      id: "aff-realitni-kancelare",
      title: "Realitní kanceláře",
      icon: "iu-aff-agency",
      description: "Odkazy na vybrané realitní kanceláře a společnosti poskytující realitní služby.",
      items: [
      ],
    },
    {
      id: "aff-reality-nemovitosti",
      title: "Reality a nemovitosti",
      icon: "iu-aff-property",
      description: "Odkazy na vybrané realitní portály a služby související s nabídkou, prodejem a pronájmem nemovitostí.",
      items: [
      ],
    },
    {
      id: "aff-kancelarske-potreby",
      title: "Kancelářské potřeby a vybavení",
      icon: "iu-aff-office",
      description: "Odkazy na vybrané obchody a služby zaměřené na kancelářské potřeby a vybavení.",
      items: [
        affPartner("Eobaly", "https://www.jdoqocy.com/click-101883843-15756667-1709047038000", "6721278")
      ],
    },
  ];

  var IU_AFFILIATE_COLORS = {};

  function refreshAffiliateColorsFromCss() {
    for (var ri = 0; ri < IU_AFFILIATE_CATALOG.length; ri++) {
      var cid = IU_AFFILIATE_CATALOG[ri].id;
      IU_AFFILIATE_COLORS[cid] = getAffCssColor(cid);
    }
  }

  var catalogById = {};
  for (var ci = 0; ci < IU_AFFILIATE_CATALOG.length; ci++) {
    catalogById[IU_AFFILIATE_CATALOG[ci].id] = IU_AFFILIATE_CATALOG[ci];
  }

  /**
   * Defense-in-depth for SVG→innerHTML (SEC-FE-007): same-origin sprite is trusted,
   * but strip script/handlers/javascript: so a compromised asset cannot XSS.
   */
  function sanitizeInlineSvgMarkup(raw) {
    var txt = String(raw || "");
    if (!txt) return "";
    if (!/<svg[\s>]/i.test(txt)) return "";
    txt = txt.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    txt = txt.replace(/<\/?foreignObject\b[^>]*>/gi, "");
    txt = txt.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    txt = txt.replace(/javascript\s*:/gi, "");
    txt = txt.replace(/data\s*:\s*text\/html/gi, "");
    txt = txt.replace(/xlink:href\s*=\s*("|')\s*javascript:[^"']*\1/gi, "");
    return txt.replace("<svg ", '<svg id="iuAffInlineSprite" ').replace(/<svg>/i, '<svg id="iuAffInlineSprite">');
  }

  function ensureAffiliateInlineSprite(done) {
    if (document.getElementById("iuAffInlineSprite")) {
      if (typeof done === "function") done();
      return;
    }
    var host = document.getElementById("iuAffInlineSpriteHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "iuAffInlineSpriteHost";
      host.hidden = true;
      host.setAttribute("aria-hidden", "true");
      document.body.insertBefore(host, document.body.firstChild);
    }
    var loaded = false;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/assets/icons/iu-sprite.svg", false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        var safeSync = sanitizeInlineSvgMarkup(xhr.responseText);
        if (safeSync) {
          host.innerHTML = safeSync;
          loaded = !!document.getElementById("iuAffInlineSprite");
        }
      }
    } catch (_) {}
    if (loaded) {
      if (typeof done === "function") done();
      return;
    }
    try {
      fetch("/assets/icons/iu-sprite.svg", { cache: "force-cache" })
        .then(function (r) {
          return r.text();
        })
        .then(function (txt) {
          if (!txt) return;
          var safeAsync = sanitizeInlineSvgMarkup(txt);
          if (!safeAsync) return;
          host.innerHTML = safeAsync;
          if (typeof done === "function") done();
        })
        .catch(function () {});
    } catch (_) {}
  }

  function createAffiliateNavIcon(iconId) {
    ensureAffiliateInlineSprite();
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "iuSvgIcon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + iconId);
    try {
      use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#" + iconId);
    } catch (_) {}
    svg.appendChild(use);
    return svg;
  }

  function ensureAffiliateViewMountPoint() {
    var view = document.getElementById("iuAffiliateView");
    var centerStage = document.getElementById("iuCenterStage");
    var jr = document.getElementById("iuJrEmptyView");
    var quickFeed = document.getElementById("iuQuickFeed");
    if (!view || !centerStage) return;

    var refNode = null;
    if (jr && jr.parentElement === centerStage) {
      refNode = jr.nextSibling;
    } else if (quickFeed && quickFeed.parentElement === centerStage) {
      refNode = quickFeed.nextSibling;
    }

    if (view.parentElement !== centerStage) {
      centerStage.insertBefore(view, refNode);
      return;
    }
    if (jr && jr.parentElement === centerStage && view.previousElementSibling !== jr) {
      centerStage.insertBefore(view, jr.nextSibling);
      return;
    }
    if (!jr && quickFeed && quickFeed.parentElement === centerStage && view.previousElementSibling !== quickFeed) {
      centerStage.insertBefore(view, quickFeed.nextSibling);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isAffiliateSectionKey(key) {
    return String(key || "").indexOf("aff-") === 0;
  }

  function getCategoryBySection(section) {
    return catalogById[String(section || "").trim().toLowerCase()] || null;
  }

  function showPlaceholderNotice(host) {
    try {
      var note = host && host.querySelector ? host.querySelector(".iuAffiliatePlaceholderNote") : null;
      if (!note) {
        note = document.createElement("div");
        note.className = "iuAffiliatePlaceholderNote";
        note.setAttribute("role", "status");
        note.setAttribute("aria-live", "polite");
        note.textContent = "Odkaz připravujeme.";
        if (host) host.appendChild(note);
      }
      note.hidden = false;
      note.classList.add("is-visible");
      clearTimeout(note.__iuAffHideTimer);
      note.__iuAffHideTimer = setTimeout(function () {
        try {
          note.classList.remove("is-visible");
          note.hidden = true;
        } catch (_) {}
      }, 2800);
    } catch (_) {}
  }

  function renderAffiliateSeo(cat) {
    var seoEl = document.getElementById("iuAffiliateSeo");
    if (!seoEl || !cat) return;
    var seo = IU_AFFILIATE_SEO[cat.id];
    if (!seo) {
      seoEl.hidden = true;
      seoEl.innerHTML = "";
      return;
    }
    var parts = ['<h2>', escapeHtml(seo.title), "</h2>"];
    for (var pi = 0; pi < seo.paragraphs.length; pi++) {
      parts.push("<p>", escapeHtml(seo.paragraphs[pi]), "</p>");
    }
    /* keywords block removed: affiliate-selected-services-neutral-v1-20260907 */
    seoEl.innerHTML = parts.join("");
    seoEl.hidden = false;
  }

  function renderAffiliateSection(section) {
    var cat = getCategoryBySection(section);
    var view = document.getElementById("iuAffiliateView");
    if (!view || !cat) return false;

    var titleEl = document.getElementById("iuAffiliateTitle");
    var subtitleEl = document.getElementById("iuAffiliateSubtitle");
    var disclosureEl = document.getElementById("iuAffiliateDisclosure");
    var gridEl = document.getElementById("iuAffiliateGrid");

    if (titleEl) titleEl.textContent = cat.title;
    if (subtitleEl) subtitleEl.textContent = cat.description;
    if (disclosureEl) renderAffiliateDisclosure(disclosureEl);

    if (gridEl) {
      var parts = [];
      for (var i = 0; i < cat.items.length; i++) {
        var it = cat.items[i];
        var ready = it.affiliateUrlReady === true && /^https:\/\//i.test(String(it.url || ""));
        /* Phase 2C: never render empty / not-ready placeholders publicly. */
        if (!ready) continue;
        var attrs =
          ' class="iuRadioChip iuAffiliateChip" role="listitem" href="' +
          escapeHtml(String(it.url)) +
          '" data-aff-ready="1" target="_blank" rel="sponsored noopener"';
        parts.push(
          "<a" +
            attrs +
            '><span class="iuRadioChipTitle">' +
            escapeHtml(it.title) +
            "</span></a>"
        );
      }
      gridEl.innerHTML = parts.join("");
    }

    view.setAttribute("data-aff-category", cat.id);
    try {
      view.removeAttribute("hidden");
      if (view.style && view.style.display === "none") view.style.removeProperty("display");
    } catch (_) {}
    renderAffiliateSeo(cat);
    ensureAffiliateViewMountPoint();
    /* Phase 3B: coupon/product cards — gated by offers-public liveEnabled (default false). */
    try {
      ensurePhase2OffersScript(function () {
        try {
          if (typeof window.iuAffiliatePhase2OffersRender === "function") {
            window.iuAffiliatePhase2OffersRender(cat.id);
          }
        } catch (_) {}
      });
    } catch (_) {}
    return true;
  }

  function handleAffiliateGridClick(e) {
    var chip = e.target && e.target.closest ? e.target.closest(".iuAffiliateChip") : null;
    if (!chip) return;
    if (chip.getAttribute("data-aff-ready") === "1") return;
    e.preventDefault();
    e.stopPropagation();
    var view = document.getElementById("iuAffiliateView");
    showPlaceholderNotice(view);
  }

  function mountLeftRailNav() {
    var nav = document.querySelector("#iuLeftRail .iu-leftNav");
    if (!nav || nav.getAttribute("data-iu-aff-nav-mounted") === "1") return;

    var title = document.createElement("div");
    title.className = "iuLeftRailSectionTitle iuLeftRailSectionTitle--affiliate";
    title.textContent = "Vybrané služby a odkazy";
    nav.appendChild(title);

    refreshAffiliateColorsFromCss();

    for (var i = 0; i < IU_AFFILIATE_CATALOG.length; i++) {
      var cat = IU_AFFILIATE_CATALOG[i];
      var a = document.createElement("a");
      a.className = "iu-leftNavItem";
      a.href = "#";
      a.setAttribute("data-rail", "affiliate");
      a.setAttribute("data-accent", cat.id);
      var iconWrap = document.createElement("span");
      iconWrap.className = "iu-leftNavIcon";
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.appendChild(createAffiliateNavIcon(cat.icon));
      var label = document.createElement("span");
      label.className = "iu-leftNavLabel";
      label.textContent = cat.title;
      a.appendChild(iconWrap);
      a.appendChild(label);
      nav.appendChild(a);
    }

    nav.setAttribute("data-iu-aff-nav-mounted", "1");
  }

  function initAffiliateCatalog() {
    ensureAffiliateInlineSprite();
    refreshAffiliateColorsFromCss();
    mountLeftRailNav();
    if (!document.__iuAffClickBound) {
      document.addEventListener("click", handleAffiliateGridClick);
      document.__iuAffClickBound = true;
    }
  }

  function applyAffiliateFromSection(section) {
    if (!isAffiliateSectionKey(section)) return false;
    try {
      if (window.__iuSectionViewsLazyMount) window.__iuSectionViewsLazyMount.ensure("affiliate");
    } catch (_) {}
    ensureAffiliateViewMountPoint();
    return renderAffiliateSection(section);
  }


  var IU_AFF_PUBLIC_SWAP_ARMED = true;
  var IU_AFF_STATIC_MAIN_CATALOG_PATH = "/projects/data/iu-affiliate-cj-main-buttons-static-v13.json";
  var IU_AFF_MANAGED_PUBLIC_PATH = "/projects/data/iu-affiliate-cj-managed-public-v1.json";
  var IU_AFF_PHASE2_OFFERS_SRC = "/assets/iu-affiliate-phase2-offers-v1.js?v=cj-phase2c-offers-v3";
  var __iuAffManagedOverlayApplied = false;
  var __iuAffPhase2OffersLoading = false;
  var __iuAffPhase2OffersLoaded = false;

  function ensurePhase2OffersScript(done) {
    if (__iuAffPhase2OffersLoaded || (window.iuAffiliatePhase2OffersRender && window.__iuAffiliatePhase2OffersBooted)) {
      __iuAffPhase2OffersLoaded = true;
      if (typeof done === "function") done(true);
      return;
    }
    if (document.querySelector('script[data-iu-aff-phase2-offers="1"]')) {
      if (typeof done === "function") {
        var waitN = 0;
        var t = setInterval(function () {
          waitN++;
          if (window.iuAffiliatePhase2OffersRender || waitN > 40) {
            clearInterval(t);
            __iuAffPhase2OffersLoaded = Boolean(window.iuAffiliatePhase2OffersRender);
            done(__iuAffPhase2OffersLoaded);
          }
        }, 50);
      }
      return;
    }
    if (__iuAffPhase2OffersLoading) {
      if (typeof done === "function") {
        var waitN2 = 0;
        var t2 = setInterval(function () {
          waitN2++;
          if (__iuAffPhase2OffersLoaded || waitN2 > 40) {
            clearInterval(t2);
            done(__iuAffPhase2OffersLoaded);
          }
        }, 50);
      }
      return;
    }
    __iuAffPhase2OffersLoading = true;
    var s = document.createElement("script");
    s.src = IU_AFF_PHASE2_OFFERS_SRC;
    s.async = true;
    s.setAttribute("data-iu-aff-phase2-offers", "1");
    s.onload = function () {
      __iuAffPhase2OffersLoading = false;
      __iuAffPhase2OffersLoaded = true;
      if (typeof done === "function") done(true);
    };
    s.onerror = function () {
      __iuAffPhase2OffersLoading = false;
      __iuAffPhase2OffersLoaded = false;
      if (typeof done === "function") done(false);
    };
    (document.head || document.documentElement).appendChild(s);
  }

  function __iuAffIsProtectedItem(it) {
    if (!it) return false;
    if (it.management === "MANUAL_PROTECTED" || it.management === "PAID_RESERVED") return true;
    /* Baseline protected partners have no advertiserId in baked catalog historically — keep https items without overlay hide. */
    return false;
  }

  /* Phase 3M: title key so baked-without-CID cannot duplicate managed / re-show ENDED. */
  function __iuAffNormTitle(t) {
    try {
      return String(t || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "");
    } catch (_) {
      return String(t || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    }
  }

  function applyManagedPublicOverlay(overlay) {
    if (!overlay || !Array.isArray(overlay.partners)) return false;
    var byAdv = {};
    var byTitle = {};
    for (var i = 0; i < overlay.partners.length; i++) {
      var p = overlay.partners[i];
      if (!p || p.advertiserId == null) continue;
      byAdv[String(p.advertiserId)] = p;
      var tn = __iuAffNormTitle(p.title);
      if (tn && !byTitle[tn]) byTitle[tn] = p;
    }
    for (var c = 0; c < IU_AFFILIATE_CATALOG.length; c++) {
      var cat = IU_AFFILIATE_CATALOG[c];
      var kept = [];
      var seenAdv = {};
      var seenTitle = {};
      for (var j = 0; j < cat.items.length; j++) {
        var it = cat.items[j];
        var adv = it.advertiserId != null ? String(it.advertiserId) : null;
        var itTitleKey = __iuAffNormTitle(it.title);
        if (adv && byAdv[adv]) {
          var ov = byAdv[adv];
          if (ov.active === false) {
            /* Never hide MANUAL_PROTECTED / PAID_RESERVED — only CJ_MANAGED */
            if (__iuAffIsProtectedItem(it)) {
              kept.push(it);
              seenAdv[adv] = true;
              if (itTitleKey) seenTitle[itTitleKey] = true;
            }
            continue;
          }
          kept.push({
            title: ov.title || it.title,
            url: ov.url || it.url,
            affiliateUrlReady: true,
            advertiserId: adv,
            management: "CJ_MANAGED",
          });
          seenAdv[adv] = true;
          if (itTitleKey) seenTitle[itTitleKey] = true;
        } else if (!adv || !byAdv[adv]) {
          var titleHit = itTitleKey ? byTitle[itTitleKey] : null;
          if (titleHit && !__iuAffIsProtectedItem(it)) {
            /* Unified lifecycle: managed authority wins over baked-without-CID */
            if (titleHit.active === false) {
              continue;
            }
            var tid = String(titleHit.advertiserId);
            if (seenAdv[tid]) continue;
            kept.push({
              title: titleHit.title || it.title,
              url: titleHit.url || it.url,
              affiliateUrlReady: true,
              advertiserId: tid,
              management: "CJ_MANAGED",
            });
            seenAdv[tid] = true;
            seenTitle[itTitleKey] = true;
            continue;
          }
          /* retain MANUAL_PROTECTED / unlisted baked partners (LKG) */
          kept.push(it);
          if (adv) seenAdv[adv] = true;
          if (itTitleKey) seenTitle[itTitleKey] = true;
        }
      }
      /* add new active managed partners for this section */
      for (var k = 0; k < overlay.partners.length; k++) {
        var np = overlay.partners[k];
        if (!np || np.active === false) continue;
        if (String(np.sectionId || "") !== String(cat.id)) continue;
        var nid = String(np.advertiserId);
        if (seenAdv[nid]) continue;
        var npTitleKey = __iuAffNormTitle(np.title);
        if (npTitleKey && seenTitle[npTitleKey]) continue;
        if (!np.url || !/^https:\/\//i.test(String(np.url))) continue;
        kept.push({
          title: np.title,
          url: np.url,
          affiliateUrlReady: true,
          advertiserId: nid,
          management: "CJ_MANAGED",
        });
        seenAdv[nid] = true;
        if (npTitleKey) seenTitle[npTitleKey] = true;
      }
      cat.items = kept;
    }
    __iuAffManagedOverlayApplied = true;
    return true;
  }

  function loadManagedPublicOverlay(done) {
    var src = IU_AFF_MANAGED_PUBLIC_PATH;
    try {
      var el = document.querySelector("[data-iu-aff-managed-src]");
      if (el) {
        var custom = el.getAttribute("data-iu-aff-managed-src");
        if (custom) src = custom;
      }
    } catch (_) {}
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (_) {}
    }, 2500);
    /* PWA/cache: bust query from clock; response also cache: no-store */
    if (src.indexOf("?") === -1) src = src + "?v=" + String(Date.now());
    else src = src + "&v=" + String(Date.now());
    var fetchOpts = { credentials: "same-origin", cache: "no-store" };
    if (ctrl) fetchOpts.signal = ctrl.signal;
    fetch(src, fetchOpts)
      .then(function (r) {
        if (!r.ok) throw new Error("overlay_http_" + r.status);
        return r.json();
      })
      .then(function (data) {
        clearTimeout(to);
        applyManagedPublicOverlay(data);
        if (typeof done === "function") done(true);
      })
      .catch(function () {
        clearTimeout(to);
        /* local-first: keep baked catalog (last-known-good) */
        if (typeof done === "function") done(false);
      });
  }

  
  function applyStaticMainCatalogV13(catalog) {
    if (!catalog || !Array.isArray(catalog.sections)) return false;
    if (catalog.publicButtonSwapArmed !== true && catalog.liveEnabled !== true) return false;
    var bySection = {};
    for (var si = 0; si < catalog.sections.length; si++) {
      var sec = catalog.sections[si];
      bySection[String(sec.sectionId)] = sec.buttons || [];
    }
    function isCjUrl(u) {
      try {
        var h = String(u || "").toLowerCase();
        return /anrdoezrs\.net|dpbolvw\.net|kqzyfj\.com|jdoqocy\.com|tkqlhce\.com|ftjcfx\.com|lduhtrp\.net|tqlkg\.com/.test(h)
          || /\/click-\d+-\d+/.test(h);
      } catch (_) { return false; }
    }
    for (var c = 0; c < IU_AFFILIATE_CATALOG.length; c++) {
      var cat = IU_AFFILIATE_CATALOG[c];
      var kept = [];
      for (var j = 0; j < cat.items.length; j++) {
        var it = cat.items[j];
        if (it && it.url && isCjUrl(it.url)) continue;
        if (it && it.management === "CJ_MANAGED") continue;
        if (it && String(it.source || "") === "static_catalog_v13") continue;
        kept.push(it);
      }
      var buttons = bySection[String(cat.id)] || [];
      for (var bi = 0; bi < buttons.length; bi++) {
        var b = buttons[bi];
        if (!b || !b.url) continue;
        kept.push({
          title: b.title,
          url: b.url,
          affiliateUrlReady: true,
          advertiserId: b.advertiserId != null ? String(b.advertiserId) : null,
          management: "CJ_STATIC_V13",
          source: "static_catalog_v13",
        });
      }
      cat.items = kept;
    }
    window.__iuAffStaticCatalogApplied = true;
    window.__iuAffPublicSwapArmed = true;
    return true;
  }

  function loadStaticMainCatalogV13(done) {
    if (!IU_AFF_PUBLIC_SWAP_ARMED) {
      if (typeof done === "function") done(false);
      return;
    }
    var src = IU_AFF_STATIC_MAIN_CATALOG_PATH;
    try {
      var el = document.querySelector("[data-iu-aff-static-src]");
      if (el) {
        var custom = el.getAttribute("data-iu-aff-static-src");
        if (custom) src = custom;
      }
    } catch (_) {}
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      try { if (ctrl) ctrl.abort(); } catch (_) {}
    }, 2500);
    if (src.indexOf("?") === -1) src = src + "?v=" + String(Date.now());
    else src = src + "&v=" + String(Date.now());
    var fetchOpts = { credentials: "same-origin", cache: "no-store" };
    if (ctrl) fetchOpts.signal = ctrl.signal;
    fetch(src, fetchOpts)
      .then(function (r) {
        if (!r.ok) throw new Error("static_http_" + r.status);
        return r.json();
      })
      .then(function (data) {
        clearTimeout(to);
        applyStaticMainCatalogV13(data);
        if (typeof done === "function") done(true);
      })
      .catch(function () {
        clearTimeout(to);
        /* keep baked LKG after swap */
        if (typeof done === "function") done(false);
      });
  }

  window.iuAffiliateApplyStaticMainCatalogV13 = applyStaticMainCatalogV13;
  window.iuAffiliateLoadStaticMainCatalogV13 = loadStaticMainCatalogV13;

  window.iuAffiliateApplyManagedPublicOverlay = applyManagedPublicOverlay;
  window.iuAffiliateLoadManagedPublicOverlay = loadManagedPublicOverlay;

  window.IU_AFFILIATE_CATALOG = IU_AFFILIATE_CATALOG;
  window.IU_AFFILIATE_SEO = IU_AFFILIATE_SEO;
  window.IU_AFFILIATE_COLORS = IU_AFFILIATE_COLORS;
  window.iuAffiliateRefreshColors = refreshAffiliateColorsFromCss;
  window.IU_AFFILIATE_DISCLOSURE_TEXT = IU_AFFILIATE_DISCLOSURE_TEXT;
  window.iuAffiliateCatalogInit = initAffiliateCatalog;
  window.iuAffiliateApplySection = applyAffiliateFromSection;
  window.iuAffiliateIsSection = isAffiliateSectionKey;
  window.iuAffiliateGetCategory = getCategoryBySection;

  initAffiliateCatalog();
  if (IU_AFF_PUBLIC_SWAP_ARMED) {
    loadStaticMainCatalogV13(function () {
      try {
        var secNow =
          (document.body && document.body.dataset && document.body.dataset.section) || "";
        if (isAffiliateSectionKey(secNow)) renderAffiliateSection(secNow);
      } catch (_) {}
    });
  } else {
    loadManagedPublicOverlay(function () {
      try {
        var secNow =
          (document.body && document.body.dataset && document.body.dataset.section) || "";
        if (isAffiliateSectionKey(secNow)) renderAffiliateSection(secNow);
      } catch (_) {}
    });
  }
  try {
    var pEarly = new URLSearchParams(typeof location !== "undefined" ? location.search || "" : "");
    var secEarly = String(pEarly.get("section") || "").trim().toLowerCase();
    if (isAffiliateSectionKey(secEarly)) {
      applyAffiliateFromSection(secEarly);
    }
  } catch (_) {}

  document.addEventListener("iu:section-view-mounted", function (ev) {
    try {
      if (ev && ev.detail && ev.detail.key === "affiliate") {
        ensureAffiliateInlineSprite();
        initAffiliateCatalog();
        ensureAffiliateViewMountPoint();
        var sec =
          (document.body && document.body.dataset && document.body.dataset.section) || "";
        if (isAffiliateSectionKey(sec)) renderAffiliateSection(sec);
      }
    } catch (_) {}
  });
})();
