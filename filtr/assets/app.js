console.log("APP.JS LOADED");

document.addEventListener("DOMContentLoaded", async () => {
  document.body.innerHTML = "<h1>infoUzel – test</h1><div id='out'>Načítám…</div>";

  try {
    const res = await fetch("data/articles.json", { cache: "no-store" });
    const json = await res.json();

    // ✅ FIX: Normalizace struktury - JSON má { generatedAt, articles: [...] }
    const items = Array.isArray(json) ? json : json.articles || [];
    
    console.log("[infoUzel] render items:", items.length);

    if (!items.length) {
      console.warn("[infoUzel] No articles to render", json);
      document.getElementById("out").innerText = "Žádné články k zobrazení";
      return;
    }

    const first = items[0];
    document.getElementById("out").innerHTML =
      "<pre>" + JSON.stringify(first, null, 2) + "</pre>";
  } catch (e) {
    document.getElementById("out").innerText = "CHYBA: " + e.message;
  }
});
