/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
/* iu-affiliate-catalog-bust: affiliate-phase2c-dynamic-ready-only-v1-20261023 */
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
  function affPartner(title, url) {
    return {
      title: title,
      url: url,
      affiliateUrlReady: true,
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
        affPartner("Cedok.cz", "https://www.anrdoezrs.net/click-101883843-15686662"),
        affPartner("Blue-style.cz", "https://www.dpbolvw.net/click-101883843-14358779"),
        affPartner("Eximtours.cz", "https://www.dpbolvw.net/click-101883843-15043859"),
        affPartner("Tui.cz", "https://www.kqzyfj.com/click-101883843-15704921"),
        affPartner("Cestovnakancelariadaka.sk", "https://www.tkqlhce.com/click-101883843-13148950"),
        affPartner("Ergo-cestovni.cz", "https://www.jdoqocy.com/click-101883843-17269644")
      ],
    },
    {
      id: "aff-ubytovani-hotely",
      title: "Ubytování a hotely",
      icon: "iu-aff-hotel",
      description: "Odkazy na vybrané služby pro ubytování a hotely.",
      items: [
        affPartner("Booking.com", "https://www.anrdoezrs.net/click-101883843-13323565"),
        affPartner("Spa.cz", "https://www.kqzyfj.com/click-101883843-14446400")
      ],
    },
    {
      id: "aff-letenky",
      title: "Doprava a cestování",
      icon: "iu-aff-transport",
      description: "Odkazy na vybrané služby související s dopravou a cestováním.",
      items: [
        affPartner("Leo Express", "https://www.jdoqocy.com/click-101883843-15736211")
      ],
    },
    {
      id: "aff-letenky-letecka-doprava",
      title: "Letenky a letecká doprava",
      icon: "iu-aff-plane",
      description: "Odkazy na vybrané služby pro letenky a leteckou dopravu.",
      items: [
        affPartner("Skytours", "https://www.jdoqocy.com/click-101883843-15733491"),
        affPartner("Arangrant", "https://www.kqzyfj.com/click-101883843-17039663"),
        affPartner("Cheapvuelos", "https://www.jdoqocy.com/click-101883843-17322005")
      ],
    },
    {
      id: "aff-cestovni-pojisteni",
      title: "Cestovní pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané služby cestovního pojištění.",
      items: [
        affPartner("AXA Assistance", "https://www.tkqlhce.com/click-101883843-12585182"),
        affPartner("Klik.cz", "https://www.dpbolvw.net/click-101883843-15024030")
      ],
    },
    {
      id: "aff-auto-moto",
      title: "Auto a moto",
      icon: "iu-aff-car",
      description: "Odkazy na vybrané obchody a služby v kategorii auto a moto.",
      items: [
        affPartner("Autohotarek.cz", "https://www.dpbolvw.net/click-101883843-15802025"),
        affPartner("Ahifi.cz", "https://www.dpbolvw.net/click-101883843-17006948")
      ],
    },
    {
      id: "aff-pneu-pneuservis",
      title: "Pneu a pneuservis",
      icon: "iu-aff-wheel",
      description:
        "Odkazy na vybrané prodejce pneumatik, pneuservisy a související služby.",
      items: [
        affPartner("BestDrive", "https://www.jdoqocy.com/click-101883843-17045434")
      ],
    },
    {
      id: "aff-pojisteni",
      title: "Pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané pojišťovny a srovnávací služby.",
      items: [
        affPartner("Klik.cz", "https://www.dpbolvw.net/click-101883843-15024026"),
        affPartner("Kalkulator.cz", "https://www.kqzyfj.com/click-101883843-15616442"),
        affPartner("GeneraliCeska.cz", "https://www.jdoqocy.com/click-101883843-13930623")
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
        affPartner("Lékárna.cz", "https://www.kqzyfj.com/click-101883843-15734937"),
        affPartner("Lékárna Lemon", "https://www.jdoqocy.com/click-101883843-14563148"),
        affPartner("GSKlub.cz", "https://www.dpbolvw.net/click-101883843-13452077")
      ],
    },
    {
      id: "aff-zdravi-doplnky",
      title: "Zdraví a doplňky",
      icon: "iu-health",
      description: "Odkazy na vybrané obchody se sortimentem zdraví a doplňků.",
      items: [
        affPartner("Klub zdraví", "https://www.dpbolvw.net/click-101883843-13884010"),
        affPartner("BodyWorld", "https://www.tkqlhce.com/click-101883843-15735791"),
        affPartner("Unizdrav", "https://www.kqzyfj.com/click-101883843-15735719"),
        affPartner("MentisLab", "https://www.tkqlhce.com/click-101883843-13341068"),
        affPartner("NaZuby.cz", "https://www.anrdoezrs.net/click-101883843-11883390"),
        affPartner("Nature's Finest", "https://www.dpbolvw.net/click-101883843-15037573"),
        affPartner("BrainMarket", "https://www.anrdoezrs.net/click-101883843-17053829"),
        affPartner("Ezshop.cz", "https://www.jdoqocy.com/click-101883843-14486512")
      ],
    },
    {
      id: "aff-kosmetika",
      title: "Kosmetika a parfémy",
      icon: "iu-aff-perfume",
      description: "Odkazy na vybrané obchody s kosmetikou a parfémy.",
      items: [
        affPartner("SEPHORA.cz", "https://www.anrdoezrs.net/click-101883843-13212014"),
        affPartner("Dermacol", "https://www.jdoqocy.com/click-101883843-17173455"),
        affPartner("FOREO", "https://www.anrdoezrs.net/click-101883843-15527432"),
        affPartner("Yves Rocher", "https://www.dpbolvw.net/click-101883843-15734904"),
        affPartner("Brasty.cz", "https://www.kqzyfj.com/click-101883843-14095529")
      ],
    },
    {
      id: "aff-drogerie",
      title: "Drogerie",
      icon: "iu-aff-bottle",
      description: "Odkazy na vybrané drogerie a související obchody.",
      items: [
        affPartner("Ecomodi", "https://www.dpbolvw.net/click-101883843-15736124"),
        affPartner("Rossmann", "https://www.dpbolvw.net/click-101883843-17204802")
      ],
    },
    {
      id: "aff-moda",
      title: "Móda a doplňky",
      icon: "iu-aff-shirt",
      description: "Odkazy na vybrané obchody s módou, oblečením a doplňky.",
      items: [
        affPartner("Meatfly.cz", "https://www.jdoqocy.com/click-101883843-15735649"),
        affPartner("Kabea.cz", "https://www.jdoqocy.com/click-101883843-15735243"),
        affPartner("Demix.cz", "https://www.tkqlhce.com/click-101883843-15202259"),
        affPartner("Trenýrkárna.cz", "https://www.dpbolvw.net/click-101883843-15736041"),
        affPartner("VIP-pradlo.cz", "https://www.jdoqocy.com/click-101883843-15769149"),
        affPartner("Instamo.cz", "https://www.anrdoezrs.net/click-101883843-15753113"),
        affPartner("Lelosi.cz", "https://www.kqzyfj.com/click-101883843-15356564")
      ],
    },
    {
      id: "aff-boty",
      title: "Boty a tenisky",
      icon: "iu-aff-shoe",
      description: "Odkazy na vybrané obchody s obuví.",
      items: [
        affPartner("Rejnok obuv", "https://www.dpbolvw.net/click-101883843-12939731"),
        affPartner("Zdrava-obuv-eshop.cz", "https://www.jdoqocy.com/click-101883843-17274691"),
        affPartner("Bohempia", "https://www.kqzyfj.com/click-101883843-15127254"),
        affPartner("Warsawsneakerstore.com", "https://www.tkqlhce.com/click-101883843-15699570")
      ],
    },
    {
      id: "aff-deti-hracky",
      title: "Děti a hračky",
      icon: "iu-aff-blocks",
      description: "Odkazy na vybrané obchody se sortimentem pro děti a hračkami.",
      items: [
        affPartner("Bambule.cz", "https://www.jdoqocy.com/click-101883843-12990634"),
        affPartner("Feedo.cz", "https://www.anrdoezrs.net/click-101883843-12984087"),
        affPartner("4KIDS.cz", "https://www.kqzyfj.com/click-101883843-14299748"),
        affPartner("Bruderland.cz", "https://www.dpbolvw.net/click-101883843-17073660"),
        affPartner("Monkeymum.com", "https://www.kqzyfj.com/click-101883843-15361176"),
        affPartner("Rajhraciek.sk", "https://www.kqzyfj.com/click-101883843-17015008")
      ],
    },
    {
      id: "aff-sportovni-obleceni",
      title: "Sportovní oblečení",
      icon: "iu-aff-jersey",
      description: "Odkazy na vybrané obchody se sportovním oblečením.",
      items: [
        affPartner("Sportisimo.cz", "https://www.tkqlhce.com/click-101883843-13592781"),
        affPartner("Horsefeathers", "https://www.anrdoezrs.net/click-101883843-15064848"),
        affPartner("Hs-sport.cz", "https://www.dpbolvw.net/click-101883843-14353861")
      ],
    },
    {
      id: "aff-sport-outdoor",
      title: "Sport a outdoor",
      icon: "iu-aff-tent",
      description: "Odkazy na vybrané obchody se sportovním a outdoorovým vybavením.",
      items: [
        affPartner("Bushman", "https://www.kqzyfj.com/click-101883843-15734377"),
        affPartner("Decathlon", "https://www.tkqlhce.com/click-101883843-15698594"),
        affPartner("inSPORTline", "https://www.dpbolvw.net/click-101883843-15734406"),
        affPartner("Bauerhockey.cz", "https://www.tkqlhce.com/click-101883843-15735817"),
        affPartner("PARYS.CZ", "https://www.jdoqocy.com/click-101883843-12905804"),
        affPartner("Urbane.cz", "https://www.kqzyfj.com/click-101883843-15359455"),
        affPartner("E-sportshop.cz", "https://www.anrdoezrs.net/click-101883843-15473642")
      ],
    },
    {
      id: "aff-dum-zahrada",
      title: "Dům a zahrada",
      icon: "iu-home-hobby",
      description: "Odkazy na vybrané obchody pro dům, zahradu a hobby.",
      items: [
        affPartner("Obi.cz", "https://www.jdoqocy.com/click-101883843-15816967"),
        affPartner("DEK.cz", "https://www.tkqlhce.com/click-101883843-13457236"),
        affPartner("Sanitino.cz", "https://www.anrdoezrs.net/click-101883843-17007319"),
        affPartner("Dormeo.cz", "https://www.dpbolvw.net/click-101883843-15806382"),
        affPartner("Zepter.cz", "https://www.kqzyfj.com/click-101883843-17074303")
      ],
    },
    {
      id: "aff-nabytek",
      title: "Bydlení a vybavení",
      icon: "iu-aff-sofa",
      description: "Odkazy na vybrané obchody s vybavením bydlení a interiéru.",
      items: [
        affPartner("ASKO-NABYTEK.CZ", "https://www.jdoqocy.com/click-101883843-12920057"),
        affPartner("Benlemi", "https://www.jdoqocy.com/click-101883843-15013146"),
        affPartner("Diablochairs", "https://www.dpbolvw.net/click-101883843-16955725"),
        affPartner("Decoronline.cz", "https://www.kqzyfj.com/click-101883843-13628208"),
        affPartner("Dx-racer.cz", "https://www.tkqlhce.com/click-101883843-14303779"),
        affPartner("Veneti.cz", "https://www.anrdoezrs.net/click-101883843-17258140")
      ],
    },
    {
      id: "aff-kuchyn",
      title: "Kuchyně a domácnost",
      icon: "iu-aff-pot",
      description: "Odkazy na vybrané obchody s vybavením kuchyně a domácnosti.",
      items: [
        affPartner("Gorenje.cz", "https://www.jdoqocy.com/click-101883843-15409134"),
        affPartner("GrilyKrby.cz", "https://www.kqzyfj.com/click-101883843-12522011"),
        affPartner("KitchenShop", "https://www.tkqlhce.com/click-101883843-17094894")
      ],
    },
    {
      id: "aff-elektro",
      title: "Elektro a chytrá domácnost",
      icon: "iu-aff-plug",
      description: "Odkazy na vybrané obchody s elektronikou a chytrou domácností.",
      items: [
        affPartner("LG CZ", "https://www.kqzyfj.com/click-101883843-17358274"),
        affPartner("Eshop.ledvance.cz", "https://www.dpbolvw.net/click-101883843-15607577"),
        affPartner("KVelektro.cz", "https://www.anrdoezrs.net/click-101883843-13812779")
      ],
    },
    {
      id: "aff-mobily",
      title: "Mobily a příslušenství",
      icon: "iu-aff-phone",
      description: "Odkazy na vybrané obchody s mobily a příslušenstvím.",
      items: [
        affPartner("Tvrzenaskla", "https://www.dpbolvw.net/click-101883843-15319706")
      ],
    },
    {
      id: "aff-software",
      title: "Software a bezpečnost",
      icon: "iu-aff-lock",
      description: "Odkazy na vybrané softwarové a bezpečnostní služby.",
      items: [
        affPartner("Kaspersky.cz", "https://www.anrdoezrs.net/click-101883843-17364722"),
        affPartner("Surfshark", "https://www.kqzyfj.com/click-101883843-15438560"),
        affPartner("Paragon Software Group", "https://www.anrdoezrs.net/click-101883843-12643722")
      ],
    },
    {
      id: "aff-knihy",
      title: "Knihy, hudba a hry",
      icon: "iu-aff-book",
      description: "Odkazy na vybrané obchody s knihami, hudbou a hrami.",
      items: [
        affPartner("KnihyDobrovsky.cz", "https://www.anrdoezrs.net/click-101883843-12733214"),
        affPartner("Martinus.cz", "https://www.kqzyfj.com/click-101883843-13771835"),
        affPartner("Grada.cz", "https://www.kqzyfj.com/click-101883843-14036380"),
        affPartner("DVD-premiery.cz", "https://www.anrdoezrs.net/click-101883843-13452100"),
        affPartner("Gorila.sk", "https://www.jdoqocy.com/click-101883843-13785660"),
        affPartner("Kytary.cz", "https://www.tkqlhce.com/click-101883843-15156146")
      ],
    },
    {
      id: "aff-jidlo",
      title: "Jídlo a potraviny",
      icon: "iu-aff-cart",
      description: "Odkazy na vybrané obchody a služby s potravinami.",
      items: [
        affPartner("Gourmetkava.cz", "https://www.tkqlhce.com/click-101883843-17138794"),
        affPartner("Svetplodu.cz", "https://www.anrdoezrs.net/click-101883843-15154793"),
        affPartner("Yummybox.cz", "https://www.jdoqocy.com/click-101883843-17298730"),
        affPartner("Zlatezrnko.cz", "https://www.dpbolvw.net/click-101883843-13992103")
      ],
    },
    {
      id: "aff-zvirata",
      title: "Zvířata a chovatelství",
      icon: "iu-aff-paw",
      description: "Odkazy na vybrané obchody pro zvířata a chovatelství.",
      items: [
        affPartner("SUPERZOO.cz", "https://www.tkqlhce.com/click-101883843-12607708"),
        affPartner("Reedog.cz", "https://www.tkqlhce.com/click-101883843-14394849")
      ],
    },
    {
      id: "aff-kvetiny-darky",
      title: "Květiny a dárky",
      icon: "iu-aff-flower",
      description: "Odkazy na vybrané obchody s květinami a dárky.",
      items: [
        affPartner("Abracadabra NYC", "https://www.dpbolvw.net/click-101883843-17267207"),
        affPartner("Firmanazazitky.cz", "https://www.tkqlhce.com/click-101883843-17346622"),
        affPartner("Hubatacernoska.cz", "https://www.tkqlhce.com/click-101883843-15082857"),
        affPartner("KvetinyExpres.cz", "https://www.tkqlhce.com/click-101883843-12081313"),
        affPartner("Manboxeo.cz", "https://www.jdoqocy.com/click-101883843-17033008")
      ],
    },
    {
      id: "aff-sperky-hodinky",
      title: "Šperky a hodinky",
      icon: "iu-aff-watch",
      description: "Odkazy na vybrané obchody se šperky a hodinkami.",
      items: [
        affPartner("ELENYS", "https://www.dpbolvw.net/click-101883843-15735899")
      ],
    },
    {
      id: "aff-tv-streamovani",
      title: "TV a streamování",
      icon: "iu-aff-tv",
      description: "Odkazy na vybrané televizní a streamovací služby.",
      items: [
      ],
    },
    {
      id: "aff-dilna-naradi",
      title: "Dílna a nářadí",
      icon: "iu-aff-hammer",
      description: "Odkazy na vybrané obchody s nářadím a vybavením dílny.",
      items: [
        affPartner("Expondo GMBH", "https://www.tkqlhce.com/click-101883843-14015762"),
        affPartner("Mojedilna.cz", "https://www.jdoqocy.com/click-101883843-14310928")
      ],
    },
    {
      id: "aff-inzerce-bazary",
      title: "Inzerce a bazary",
      icon: "iu-aff-marketplace",
      description: "Odkazy na vybrané inzertní portály, bazary, online tržiště a související služby.",
      items: [
        affPartner("Allegro.cz", "https://www.tkqlhce.com/click-101883843-15520149"),
        affPartner("Aukro.cz", "https://www.kqzyfj.com/click-101883843-13276590")
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
        affPartner("Obchod.activa.cz", "https://www.anrdoezrs.net/click-101883843-15037752"),
        affPartner("Eobaly.cz", "https://www.anrdoezrs.net/click-101883843-15756667")
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
