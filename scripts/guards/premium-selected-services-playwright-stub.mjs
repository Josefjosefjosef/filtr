/**
 * Playwright guard stub: Premium Selected Services public API must never hit
 * production ads.infouzel.cz during localhost guard runs (affiliate + premium guards).
 */
const DEFAULT_CATALOG = {
  category: "aff-zdravi-doplnky",
  sales_panel_hint_cs:
    "Pořadí reklam se automaticky posouvá nahoru, pokud před nimi není obsazená vyšší pozice. Zakoupená pozice určuje nejzazší pořadí, na kterém se může reklama zobrazit. Dočasně lepší zobrazení nezakládá nárok na jiný produkt, slevu ani refund.",
  slots: [
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.01",
      position: 1,
      publicly_listed: true,
      buyable: false,
      sale_state: "live",
      price_label_cs: "5 990 Kč bez DPH / 6 měsíců",
      position_label_cs: "1. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.03",
      position: 3,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p3",
      price_label_cs: "5 390 Kč bez DPH / 6 měsíců",
      position_label_cs: "3. pozice v této sekci",
    },
  ],
  measurement: { impressions: false, clicks: false, ctr: false },
};

const DEFAULT_RENDER = {
  active: [],
  measurement: { impressions: false, clicks: false, ctr: false },
};

function categoryFromUrl(url) {
  try {
    const u = new URL(url);
    const cat = u.searchParams.get("category");
    if (cat && cat.startsWith("aff-")) return cat;
  } catch (_) {}
  return DEFAULT_CATALOG.category;
}

function catalogForCategory(category) {
  return {
    ...DEFAULT_CATALOG,
    category,
    slots: DEFAULT_CATALOG.slots.map((slot) => ({
      ...slot,
      placement_id: slot.placement_id.replace("aff-zdravi-doplnky", category),
    })),
  };
}

function isPremiumSelectedServicesUrl(url) {
  return (
    /\/v1\/public\/premium\/selected-services\//i.test(url) &&
    (url.includes("ads.infouzel.cz") || url.includes("127.0.0.1") || url.includes("localhost"))
  );
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {{ onProdLeak?: (url: string) => void }} [opts]
 */
export async function installPremiumSelectedServicesStubOnContext(context, opts = {}) {
  if (!context || typeof context.route !== "function") return;
  const onProdLeak = typeof opts.onProdLeak === "function" ? opts.onProdLeak : null;

  await context.route(/\/v1\/public\/premium\/selected-services\//, async (route) => {
    const url = route.request().url();
    if (/https:\/\/ads\.infouzel\.cz\//i.test(url) && onProdLeak) {
      onProdLeak(url);
    }
    const category = categoryFromUrl(url);
    const body = url.includes("/render")
      ? JSON.stringify(DEFAULT_RENDER)
      : JSON.stringify(catalogForCategory(category));
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

export function createProdPremiumLeakTracker() {
  const leaks = [];
  return {
    leaks,
    onProdLeak(url) {
      if (/https:\/\/ads\.infouzel\.cz\/v1\/public\/premium\/selected-services\//i.test(url)) {
        leaks.push(url);
      }
    },
    assertZero() {
      if (leaks.length) {
        const msg = "PRODUCTION_PREMIUM_API_LEAK count=" + leaks.length + " sample=" + leaks.slice(0, 3).join(" | ");
        throw new Error(msg);
      }
    },
  };
}
