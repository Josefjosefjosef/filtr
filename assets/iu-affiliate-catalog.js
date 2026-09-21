/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
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
        affItem("", "cedok"),
        affItem("", "blue-style"),
        affItem("", "fischer"),
        affItem("", "exim-tours"),
        affItem("", "nev-dama"),
        affItem("", "tui"),
        affItem("", "invia"),
        affItem("", "dovolena-cz"),
      ],
    },
    {
      id: "aff-ubytovani-hotely",
      title: "Ubytování a hotely",
      icon: "iu-aff-hotel",
      description: "Odkazy na vybrané služby pro ubytování a hotely.",
      items: [
        affPartner(
          "Booking.com",
          "https://www.anrdoezrs.net/click-101883843-13323565"
        ),
        affItem("", "agoda"),
        affItem("", "hotels-com"),
        affItem("", "spa-cz"),
        affItem("", "slevomat-pobyty"),
        affItem("", "travelking"),
        affItem("", "hotel-cz"),
        affItem("", "megaubytka"),
      ],
    },
    {
      id: "aff-letenky",
      title: "Doprava a cestování",
      icon: "iu-aff-transport",
      description: "Odkazy na vybrané služby související s dopravou a cestováním.",
      items: [
        affPartner(
          "Leo Express",
          "https://www.jdoqocy.com/click-101883843-15736211"
        ),
        affItem("", "airhelp"),
        affItem("", "refundio"),
        affItem("", "kiwi"),
        affItem("", "letuska"),
        affItem("", "pelikan"),
        affItem("", "lot"),
        affItem("", "flixbus"),
      ],
    },
    {
      id: "aff-letenky-letecka-doprava",
      title: "Letenky a letecká doprava",
      icon: "iu-aff-plane",
      description: "Odkazy na vybrané služby pro letenky a leteckou dopravu.",
      items: [
        affItem("", "letenky-letecka-empty-1"),
        affItem("", "letenky-letecka-empty-2"),
        affItem("", "letenky-letecka-empty-3"),
        affItem("", "letenky-letecka-empty-4"),
        affItem("", "letenky-letecka-empty-5"),
        affItem("", "letenky-letecka-empty-6"),
        affItem("", "letenky-letecka-empty-7"),
        affItem("", "letenky-letecka-empty-8"),
      ],
    },
    {
      id: "aff-cestovni-pojisteni",
      title: "Cestovní pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané služby cestovního pojištění.",
      items: [
        affPartner(
          "AXA Assistance",
          "https://www.tkqlhce.com/click-101883843-12585182"
        ),
        affPartner(
          "Klik.cz",
          "https://www.dpbolvw.net/click-101883843-15024030"
        ),
        affItem("", "ergo-cestovni"),
        affItem("", "generali-cestovni"),
        affItem("", "csob-cestovni"),
        affItem("", "slavia-cestovni"),
        affItem("", "cestovni-pojisteni-empty-7"),
        affItem("", "cestovni-pojisteni-empty-8"),
      ],
    },
    {
      id: "aff-auto-moto",
      title: "Auto a moto",
      icon: "iu-aff-car",
      description: "Odkazy na vybrané obchody a služby v kategorii auto a moto.",
      items: [
        affPartner(
          "Autohotarek.cz",
          "https://www.dpbolvw.net/click-101883843-15802025"
        ),
        affPartner(
          "Ahifi.cz",
          "https://www.dpbolvw.net/click-101883843-17006948"
        ),
        affItem("", "autohotarek"),
        affItem("", "bestdrive"),
        affItem("", "xl-moto"),
        affItem("", "pneuboss"),
        affItem("", "pneuleader"),
        affItem("", "motozem"),
      ],
    },
    {
      id: "aff-pneu-pneuservis",
      title: "Pneu a pneuservis",
      icon: "iu-aff-wheel",
      description:
        "Odkazy na vybrané prodejce pneumatik, pneuservisy a související služby.",
      items: [
        affItem("", "pneu-pneuservis-empty-1"),
        affItem("", "pneu-pneuservis-empty-2"),
        affItem("", "pneu-pneuservis-empty-3"),
        affItem("", "pneu-pneuservis-empty-4"),
        affItem("", "pneu-pneuservis-empty-5"),
        affItem("", "pneu-pneuservis-empty-6"),
        affItem("", "pneu-pneuservis-empty-7"),
        affItem("", "pneu-pneuservis-empty-8"),
      ],
    },
    {
      id: "aff-pojisteni",
      title: "Pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané pojišťovny a srovnávací služby.",
      items: [
        affItem("", "direct-pojisteni"),
        affItem("", "klikpojisteni"),
        affItem("", "kalkulator-pojisteni"),
        affItem("", "generali-pojisteni"),
        affItem("", "csob-pojisteni"),
        affItem("", "slavia-pojisteni"),
        affItem("", "pillow"),
        affItem("", "uniqa"),
      ],
    },
    {
      id: "aff-finance",
      title: "Finance",
      icon: "iu-finance",
      description: "Odkazy na vybrané externí finanční služby.",
      items: [
        affItem("", "skip-pay"),
        affItem("", "portu"),
        affItem("", "zonky"),
        affItem("", "kalkulator-finance"),
        affItem("", "partners"),
        affItem("", "kamali"),
        affItem("", "twisto"),
        affItem("", "csob-finance"),
      ],
    },
    {
      id: "aff-energie-uspor",
      title: "Energie a úspory",
      icon: "iu-aff-bulb",
      description: "Odkazy na vybrané služby a obchody související s energiemi a úsporami.",
      items: [
        affItem("", "kalkulator-energie"),
        affItem("", "smd-led"),
        affItem("", "ledvance"),
        affItem("", "tipa"),
        affItem("", "eon"),
        affItem("", "cez"),
        affItem("", "energeticky-srovnavac"),
        affItem("", "usporne-osvetleni"),
      ],
    },
    {
      id: "aff-lekarny",
      title: "Lékárny",
      icon: "iu-aff-cross",
      description: "Odkazy na vybrané externí lékárny a související obchody.",
      items: [
        affItem("", "dr-max"),
        affItem("", "pilulka"),
        affItem("", "lekarna-cz"),
        affItem("", "benu"),
        affItem("", "lekarna-lemon"),
        affItem("", "unizdrav"),
        affItem("", "moje-lekarna"),
        affItem("", "gigalekarna"),
      ],
    },
    {
      id: "aff-zdravi-doplnky",
      title: "Zdraví a doplňky",
      icon: "iu-health",
      description: "Odkazy na vybrané obchody se sortimentem zdraví a doplňků.",
      items: [
        affItem("", "klub-zdravi"),
        affItem("", "gs-klub"),
        affItem("", "terezia"),
        affItem("", "sensilab"),
        affItem("", "prodietix"),
        affItem("", "rehabilitacni-pomucky"),
        affItem("", "prozdravi"),
        affItem("", "brainmarket"),
      ],
    },
    {
      id: "aff-kosmetika",
      title: "Kosmetika a parfémy",
      icon: "iu-aff-perfume",
      description: "Odkazy na vybrané obchody s kosmetikou a parfémy.",
      items: [
        affItem("", "notino"),
        affItem("", "sephora"),
        affItem("", "dermacol"),
        affItem("", "fann"),
        affItem("", "marionnaud"),
        affItem("", "loccitane"),
        affItem("", "brasty"),
        affItem("", "pinkpanda"),
      ],
    },
    {
      id: "aff-drogerie",
      title: "Drogerie",
      icon: "iu-aff-bottle",
      description: "Odkazy na vybrané drogerie a související obchody.",
      items: [
        affItem("", "rossmann"),
        affItem("", "teta-drogerie"),
        affItem("", "drogerko"),
        affItem("", "dedra"),
        affItem("", "tierra-verde"),
        affItem("", "econea"),
        affItem("", "vmd-drogerie"),
        affItem("", "country-life-drogerie"),
      ],
    },
    {
      id: "aff-moda",
      title: "Móda a doplňky",
      icon: "iu-aff-shirt",
      description: "Odkazy na vybrané obchody s módou, oblečením a doplňky.",
      items: [
        affItem("", "answear"),
        affItem("", "reserved"),
        affItem("", "cropp"),
        affItem("", "housebrand"),
        affItem("", "factcool"),
        affItem("", "bushman"),
        affItem("", "prm"),
        affItem("", "gant"),
      ],
    },
    {
      id: "aff-boty",
      title: "Boty a tenisky",
      icon: "iu-aff-shoe",
      description: "Odkazy na vybrané obchody s obuví.",
      items: [
        affItem("", "footshop"),
        affItem("", "queens"),
        affItem("", "shooos"),
        affItem("", "rejnok"),
        affItem("", "realfoot"),
        affItem("", "belenka"),
        affItem("", "barebarics"),
        affItem("", "skinners"),
      ],
    },
    {
      id: "aff-deti-hracky",
      title: "Děti a hračky",
      icon: "iu-aff-blocks",
      description: "Odkazy na vybrané obchody se sortimentem pro děti a hračkami.",
      items: [
        affItem("", "deti-hracky-1"),
        affItem("", "deti-hracky-2"),
        affItem("", "deti-hracky-3"),
        affItem("", "deti-hracky-4"),
        affItem("", "deti-hracky-5"),
        affItem("", "deti-hracky-6"),
        affItem("", "deti-hracky-7"),
        affItem("", "deti-hracky-8"),
      ],
    },
    {
      id: "aff-sportovni-obleceni",
      title: "Sportovní oblečení",
      icon: "iu-aff-jersey",
      description: "Odkazy na vybrané obchody se sportovním oblečením.",
      items: [
        affItem("", "sportisimo"),
        affItem("", "decathlon"),
        affItem("", "bezvasport"),
        affItem("", "meatfly"),
        affItem("", "horsefeathers"),
        affItem("", "husky"),
        affItem("", "jd-sports"),
        affItem("", "top4sport"),
      ],
    },
    {
      id: "aff-sport-outdoor",
      title: "Sport a outdoor",
      icon: "iu-aff-tent",
      description: "Odkazy na vybrané obchody se sportovním a outdoorovým vybavením.",
      items: [
        affItem("", "4camping"),
        affItem("", "insportline"),
        affItem("", "sportobchod"),
        affItem("", "2sport"),
        affItem("", "bauer-hockey"),
        affItem("", "d-sport"),
        affItem("", "chytapust"),
        affItem("", "parys"),
      ],
    },
    {
      id: "aff-dum-zahrada",
      title: "Dům a zahrada",
      icon: "iu-home-hobby",
      description: "Odkazy na vybrané obchody pro dům, zahradu a hobby.",
      items: [
        affItem("", "obi"),
        affItem("", "baumax"),
        affItem("", "dek"),
        affItem("", "jarabak"),
        affItem("", "sanitino"),
        affItem("", "siko"),
        affItem("", "dumzahrada"),
        affItem("", "mountfield"),
      ],
    },
    {
      id: "aff-nabytek",
      title: "Bydlení a vybavení",
      icon: "iu-aff-sofa",
      description: "Odkazy na vybrané obchody s vybavením bydlení a interiéru.",
      items: [
        affItem("", "asko-nabytek"),
        affItem("", "benlemi"),
        affItem("", "bonami"),
        affItem("", "raj-nabytku"),
        affItem("", "ezidle"),
        affItem("", "diablochairs"),
        affItem("", "dormeo"),
        affItem("", "beliani"),
      ],
    },
    {
      id: "aff-kuchyn",
      title: "Kuchyně a domácnost",
      icon: "iu-aff-pot",
      description: "Odkazy na vybrané obchody s vybavením kuchyně a domácnosti.",
      items: [
        affItem("", "tescoma"),
        affItem("", "fabini"),
        affItem("", "home-cook"),
        affItem("", "duka"),
        affItem("", "philips-home"),
        affItem("", "karcher"),
        affItem("", "mediashop"),
        affItem("", "lauben"),
      ],
    },
    {
      id: "aff-elektro",
      title: "Elektro a chytrá domácnost",
      icon: "iu-aff-plug",
      description: "Odkazy na vybrané obchody s elektronikou a chytrou domácností.",
      items: [
        affItem("", "lg"),
        affItem("", "philips"),
        affItem("", "irobot"),
        affItem("", "robotworld"),
        affItem("", "roboticky-vysavac"),
        affItem("", "djishop"),
        affItem("", "gorenje"),
        affItem("", "truelife"),
      ],
    },
    {
      id: "aff-mobily",
      title: "Mobily a příslušenství",
      icon: "iu-aff-phone",
      description: "Odkazy na vybrané obchody s mobily a příslušenstvím.",
      items: [
        affItem("", "f-mobil"),
        affItem("", "tvrzenaskla"),
        affItem("", "momanio"),
        affItem("", "picasee"),
        affItem("", "rcobchod"),
        affItem("", "allegro"),
        affItem("", "temu"),
        affItem("", "mobil-pohotovost"),
      ],
    },
    {
      id: "aff-software",
      title: "Software a bezpečnost",
      icon: "iu-aff-lock",
      description: "Odkazy na vybrané softwarové a bezpečnostní služby.",
      items: [
        affItem("", "kaspersky"),
        affItem("", "norton"),
        affItem("", "eset"),
        affItem("", "avast"),
        affItem("", "nordvpn"),
        affItem("", "surfshark"),
        affItem("", "cyberghost"),
        affItem("", "softwarepro"),
      ],
    },
    {
      id: "aff-knihy",
      title: "Knihy, hudba a hry",
      icon: "iu-aff-book",
      description: "Odkazy na vybrané obchody s knihami, hudbou a hrami.",
      items: [
        affItem("", "dobrovsky"),
        affItem("", "martinus"),
        affItem("", "libristo"),
        affItem("", "grada"),
        affItem("", "albi"),
        affItem("", "bambule"),
        affItem("", "dvd-premiery"),
        affItem("", "skyshowtime"),
      ],
    },
    {
      id: "aff-jidlo",
      title: "Jídlo a potraviny",
      icon: "iu-aff-cart",
      description: "Odkazy na vybrané obchody a služby s potravinami.",
      items: [
        affItem("", "rohlik"),
        affItem("", "tesco"),
        affItem("", "grizly"),
        affItem("", "gourmetkava"),
        affItem("", "svet-plodu"),
        affItem("", "bam-cokolada"),
        affItem("", "country-life"),
        affItem("", "aktin"),
      ],
    },
    {
      id: "aff-zvirata",
      title: "Zvířata a chovatelství",
      icon: "iu-aff-paw",
      description: "Odkazy na vybrané obchody pro zvířata a chovatelství.",
      items: [
        affItem("", "superzoo"),
        affItem("", "petcenter"),
        affItem("", "petissimo"),
        affItem("", "spokojeny-pes"),
        affItem("", "dogbarkode"),
        affItem("", "reedog"),
        affItem("", "demix"),
        affItem("", "zoohit"),
      ],
    },
    {
      id: "aff-kvetiny-darky",
      title: "Květiny a dárky",
      icon: "iu-aff-flower",
      description: "Odkazy na vybrané obchody s květinami a dárky.",
      items: [
        affItem("", "kvetiny-empty-1"),
        affItem("", "kvetiny-empty-2"),
        affItem("", "kvetiny-empty-3"),
        affItem("", "kvetiny-empty-4"),
        affItem("", "kvetiny-empty-5"),
        affItem("", "kvetiny-empty-6"),
        affItem("", "kvetiny-empty-7"),
        affItem("", "kvetiny-empty-8"),
      ],
    },
    {
      id: "aff-sperky-hodinky",
      title: "Šperky a hodinky",
      icon: "iu-aff-watch",
      description: "Odkazy na vybrané obchody se šperky a hodinkami.",
      items: [
        affItem("", "sperky-empty-1"),
        affItem("", "sperky-empty-2"),
        affItem("", "sperky-empty-3"),
        affItem("", "sperky-empty-4"),
        affItem("", "sperky-empty-5"),
        affItem("", "sperky-empty-6"),
        affItem("", "sperky-empty-7"),
        affItem("", "sperky-empty-8"),
      ],
    },
    {
      id: "aff-tv-streamovani",
      title: "TV a streamování",
      icon: "iu-aff-tv",
      description: "Odkazy na vybrané televizní a streamovací služby.",
      items: [
        affItem("", "streamovani-empty-1"),
        affItem("", "streamovani-empty-2"),
        affItem("", "streamovani-empty-3"),
        affItem("", "streamovani-empty-4"),
        affItem("", "streamovani-empty-5"),
        affItem("", "streamovani-empty-6"),
        affItem("", "streamovani-empty-7"),
        affItem("", "streamovani-empty-8"),
      ],
    },
    {
      id: "aff-dilna-naradi",
      title: "Dílna a nářadí",
      icon: "iu-aff-hammer",
      description: "Odkazy na vybrané obchody s nářadím a vybavením dílny.",
      items: [
        affItem("", "dilna-empty-1"),
        affItem("", "dilna-empty-2"),
        affItem("", "dilna-empty-3"),
        affItem("", "dilna-empty-4"),
        affItem("", "dilna-empty-5"),
        affItem("", "dilna-empty-6"),
        affItem("", "dilna-empty-7"),
        affItem("", "dilna-empty-8"),
      ],
    },
    {
      id: "aff-inzerce-bazary",
      title: "Inzerce a bazary",
      icon: "iu-aff-marketplace",
      description: "Odkazy na vybrané inzertní portály, bazary, online tržiště a související služby.",
      items: [
        affItem("", "inzerce-empty-1"),
        affItem("", "inzerce-empty-2"),
        affItem("", "inzerce-empty-3"),
        affItem("", "inzerce-empty-4"),
        affItem("", "inzerce-empty-5"),
        affItem("", "inzerce-empty-6"),
        affItem("", "inzerce-empty-7"),
        affItem("", "inzerce-empty-8"),
      ],
    },
    {
      id: "aff-realitni-kancelare",
      title: "Realitní kanceláře",
      icon: "iu-aff-agency",
      description: "Odkazy na vybrané realitní kanceláře a společnosti poskytující realitní služby.",
      items: [
        affItem("", "realitni-kancelare-empty-1"),
        affItem("", "realitni-kancelare-empty-2"),
        affItem("", "realitni-kancelare-empty-3"),
        affItem("", "realitni-kancelare-empty-4"),
        affItem("", "realitni-kancelare-empty-5"),
        affItem("", "realitni-kancelare-empty-6"),
        affItem("", "realitni-kancelare-empty-7"),
        affItem("", "realitni-kancelare-empty-8"),
      ],
    },
    {
      id: "aff-reality-nemovitosti",
      title: "Reality a nemovitosti",
      icon: "iu-aff-property",
      description: "Odkazy na vybrané realitní portály a služby související s nabídkou, prodejem a pronájmem nemovitostí.",
      items: [
        affItem("", "reality-empty-1"),
        affItem("", "reality-empty-2"),
        affItem("", "reality-empty-3"),
        affItem("", "reality-empty-4"),
        affItem("", "reality-empty-5"),
        affItem("", "reality-empty-6"),
        affItem("", "reality-empty-7"),
        affItem("", "reality-empty-8"),
      ],
    },
    {
      id: "aff-kancelarske-potreby",
      title: "Kancelářské potřeby a vybavení",
      icon: "iu-aff-office",
      description: "Odkazy na vybrané obchody a služby zaměřené na kancelářské potřeby a vybavení.",
      items: [
        affItem("", "kancelarske-empty-1"),
        affItem("", "kancelarske-empty-2"),
        affItem("", "kancelarske-empty-3"),
        affItem("", "kancelarske-empty-4"),
        affItem("", "kancelarske-empty-5"),
        affItem("", "kancelarske-empty-6"),
        affItem("", "kancelarske-empty-7"),
        affItem("", "kancelarske-empty-8"),
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
        var href = ready ? String(it.url) : "#";
        var attrs =
          ' class="iuRadioChip iuAffiliateChip" role="listitem" href="' +
          escapeHtml(href) +
          '" data-aff-ready="' +
          (ready ? "1" : "0") +
          '"';
        if (ready) {
          /* Affiliate contract: sponsored + noopener, new tab. No nofollow / noreferrer. */
          attrs += ' target="_blank" rel="sponsored noopener"';
        } else {
          attrs += ' aria-disabled="true"';
        }
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
