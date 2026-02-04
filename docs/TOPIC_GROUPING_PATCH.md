# Patch: Seskupování médií pod jedno téma (12h okno)

## Přehled

Tento patch přidává seskupování článků podle tématu s časovým oknem 12 hodin. Články o stejné události z různých médií se sloučí do jedné karty s rozšířenými `sources[]`.

**Místo napojení:** `loadData()` funkce, mezi `sanitizedArticles` a `buildCombinedFeed()`

**Bezpečnost:** Nezasahuje do `normalizeArticleList`, `applyFilter`, `renderFeed`, ani `state.*` logiky.

---

## A) Feature Flags

Přidej na začátek `loadData()` funkce (kolem řádku 2098), nebo na top-level scope před `loadData()`:

```javascript
// === TOPIC GROUPING FEATURE ===
const ENABLE_TOPIC_GROUPING = true;
const TOPIC_GROUPING_TIME_WINDOW_HOURS = 12;
const TOPIC_GROUPING_MAX_OTHERS = 999; // žádný limit na počet sloučených článků
```

---

## B) Pomocné funkce

Přidej tyto funkce **před** `loadData()` funkci (kolem řádku 2089):

### B1) normalizeTitleForKey(title)

Normalizuje title pro výpočet klíče tématu:

```javascript
function normalizeTitleForKey(title) {
  if (!title || typeof title !== "string") return "";
  
  let normalized = title
    .toLowerCase()
    // Odstranění diakritiky (základní)
    .replace(/[áàä]/g, "a")
    .replace(/[éèě]/g, "e")
    .replace(/[íì]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùůü]/g, "u")
    .replace(/[ý]/g, "y")
    .replace(/[č]/g, "c")
    .replace(/[ď]/g, "d")
    .replace(/[ň]/g, "n")
    .replace(/[ř]/g, "r")
    .replace(/[š]/g, "s")
    .replace(/[ť]/g, "t")
    .replace(/[ž]/g, "z")
    // Odstranění interpunkce a speciálních znaků
    .replace(/[^\w\s]/g, " ")
    // Odstranění čísel (konzervativně - jen samostatné)
    .replace(/\b\d+\b/g, " ")
    // Redukce whitespace
    .replace(/\s+/g, " ")
    .trim();
  
  // Odstranění "měkkých" stop slov (konzervativně)
  const softStopWords = ["video", "zive", "aktualne", "live", "breaking"];
  const words = normalized.split(/\s+/);
  const filtered = words.filter(w => w.length > 2 && !softStopWords.includes(w));
  
  return filtered.join(" ");
}
```

### B2) computeTopicKey(article)

Vypočítá klíč tématu z článku:

```javascript
function computeTopicKey(article) {
  if (!article) return null;
  
  const title = article.title || article.headline || article.name || "";
  const normalizedTitle = normalizeTitleForKey(title);
  
  // Pokud normalizovaný title je příliš krátký (< 10 znaků), použij fallback
  if (normalizedTitle.length < 10) {
    const topic = (article.topic || "").toLowerCase().trim();
    const section = (article.section || "").toLowerCase().trim();
    if (topic || section) {
      return `${topic}||${section}`;
    }
  }
  
  return normalizedTitle || null;
}
```

### B3) mergeSourcesDedup(sourcesArrayList)

Sloučí a deduplikuje sources z více článků:

```javascript
function mergeSourcesDedup(sourcesArrayList) {
  const seen = new Set();
  const merged = [];
  
  for (const sources of sourcesArrayList) {
    if (!Array.isArray(sources)) continue;
    
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      
      const name = String(source.name || source.title || "").trim();
      const url = String(source.url || source.link || "").trim();
      
      if (!name || !url) continue;
      
      // Klíč pro deduplikaci: url + name (case-insensitive)
      const key = `${url.toLowerCase()}||${name.toLowerCase()}`;
      
      if (seen.has(key)) continue;
      seen.add(key);
      
      merged.push({ name, url });
    }
  }
  
  return merged;
}
```

---

## C) groupArticlesByTopic(articles, hours)

Hlavní funkce pro seskupování článků:

```javascript
function groupArticlesByTopic(articles, hours) {
  if (!Array.isArray(articles) || articles.length === 0) return articles;
  if (!Number.isFinite(hours) || hours <= 0) return articles;
  
  // Mapování: topicKey -> skupina článků
  const groups = new Map();
  
  // Krok 1: Seřadit články podle publishedAt (ASC - nejstarší první)
  const sorted = [...articles].sort((a, b) => {
    const ta = new Date(a.publishedAt || a.date || a.published || 0).getTime();
    const tb = new Date(b.publishedAt || b.date || b.published || 0).getTime();
    return ta - tb; // ASC
  });
  
  // Krok 2: Seskupit články podle topicKey
  for (const article of sorted) {
    const topicKey = computeTopicKey(article);
    if (!topicKey) {
      // Pokud nelze vypočítat klíč, ponechat článek samostatně
      continue;
    }
    
    if (!groups.has(topicKey)) {
      // Nová skupina - první článek je hlavní
      const publishedAt = article.publishedAt || article.date || article.published || "";
      const firstTime = new Date(publishedAt).getTime();
      
      groups.set(topicKey, {
        primary: article,
        related: [],
        firstTime: firstTime,
        timeWindowEnd: firstTime + (hours * 60 * 60 * 1000), // +hours v ms
      });
    } else {
      // Existující skupina - zkontrolovat časové okno
      const group = groups.get(topicKey);
      const articleTime = new Date(article.publishedAt || article.date || article.published || 0).getTime();
      
      if (articleTime <= group.timeWindowEnd) {
        // Článek spadá do časového okna - přidat do related
        group.related.push(article);
      }
      // Pokud je mimo okno, ignorovat (jiná událost, jen podobný title)
    }
  }
  
  // Krok 3: Vytvořit výstupní články ze skupin
  const result = [];
  
  for (const [topicKey, group] of groups.entries()) {
    const primary = group.primary;
    
    // Sloučit sources z primary + related
    const allSources = [
      Array.isArray(primary.sources) ? primary.sources : [],
      ...group.related.map(a => Array.isArray(a.sources) ? a.sources : [])
    ];
    const mergedSources = mergeSourcesDedup(allSources);
    
    // Validace výstupního článku
    if (!primary.title || !primary.url || !Array.isArray(mergedSources)) {
      debugWarn("[GROUP] Invalid grouped article, skipping", { topicKey, primary });
      // Fallback: přidat primary samostatně
      result.push(primary);
      continue;
    }
    
    // Vytvořit seskupený článek
    const groupedArticle = {
      ...primary,
      sources: mergedSources,
      // Volitelné metadata pro debug
      _groupMeta: {
        relatedCount: group.related.length,
        timeWindow: `${hours}h`,
        topicKey: topicKey,
      },
    };
    
    result.push(groupedArticle);
  }
  
  // Krok 4: Přidat články, které nemají topicKey (nebyly seskupeny)
  for (const article of sorted) {
    const topicKey = computeTopicKey(article);
    if (!topicKey) {
      result.push(article);
    }
  }
  
  return result;
}
```

---

## D) Napojení do loadData()

**Přesné místo:** V `loadData()` funkci, **před** řádek 2320 (`const combined = buildCombinedFeed(...)`)

**Kontext (řádky 2254-2320):**

```javascript
      debugLog("[DATA] articles loaded count=", sanitizedArticles.length);
      debugLog("[DATA] articles first=", sanitizedArticles[0]?.title, sanitizedArticles[0]?.url);
      if (isDebugLogging) {
      debugLog("[ARTICLES] loaded", sanitizedArticles.length, sanitizedArticles.slice(0, 3));
      }

      const safeVideosArray = Array.isArray(videosArr) ? videosArr : [];
      // ... (video processing) ...
      
      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] request canceled, token", requestToken);
        return;
      }
      // ⬇️ SEM VLOŽIT NOVÝ KÓD ⬇️
      const combined = buildCombinedFeed(sanitizedArticles, videoItems);
```

**Vložit tento blok:**

```javascript
      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] request canceled, token", requestToken);
        return;
      }
      
      // === TOPIC GROUPING ===
      let articlesForFeed = sanitizedArticles;
      if (ENABLE_TOPIC_GROUPING) {
        try {
          const grouped = groupArticlesByTopic(sanitizedArticles, TOPIC_GROUPING_TIME_WINDOW_HOURS);
          
          // Validace výstupu
          const isValid = Array.isArray(grouped) && grouped.every(item => 
            item && 
            typeof item.title === "string" && 
            typeof item.url === "string" && 
            Array.isArray(item.sources)
          );
          
          if (isValid) {
            articlesForFeed = grouped;
            debugLog("[GROUP] articles grouped:", sanitizedArticles.length, "->", grouped.length);
          } else {
            debugWarn("[GROUP] Validation failed, using original articles");
            articlesForFeed = sanitizedArticles;
          }
        } catch (err) {
          debugWarn("[GROUP] Error during grouping:", err);
          articlesForFeed = sanitizedArticles; // Fallback na původní
        }
      }
      
      const combined = buildCombinedFeed(articlesForFeed, videoItems);
```

**Změna:** `buildCombinedFeed(sanitizedArticles, videoItems)` → `buildCombinedFeed(articlesForFeed, videoItems)`

---

## E) Pojistky

### E1) Validace výstupu

- Každý seskupený článek musí mít `title`, `url`, `sources[]`
- Pokud validace selže → fallback na původní `sanitizedArticles`

### E2) Error handling

- Try-catch kolem `groupArticlesByTopic()`
- Při chybě → fallback na původní články
- Debug logování všech chyb

### E3) Feature flag

- `ENABLE_TOPIC_GROUPING = false` → vypne seskupování bez změny kódu
- Umožňuje rychlé vypnutí při problémech

---

## F) Testovací checklist

### ✅ Test 1: Seskupení stejné události
**Vstup:** 2-3 články se stejným normalizovaným title, v rozmezí 12h
**Očekávání:** 1 karta s rozšířenými `sources[]`

**Příklad:**
- Článek A: "Dopravní nehoda na D1", 13:00, ČT24
- Článek B: "Dopravní nehoda na D1", 13:15, iDNES.cz
- Článek C: "Dopravní nehoda na D1", 13:30, Novinky.cz

**Výstup:** 1 karta s `sources: [ČT24, iDNES.cz, Novinky.cz]`

### ✅ Test 2: Dvě různé události se stejným topic
**Vstup:** 2 články se stejným `topic: "doprava"`, ale různými titulky, v rozmezí 12h
**Očekávání:** 2 samostatné karty (nesmí se slít)

**Příklad:**
- Článek A: "Nehoda na D1", 13:00, topic: "doprava"
- Článek B: "Zácpa na D5", 13:30, topic: "doprava"

**Výstup:** 2 karty (různé normalizované titulky → různé topicKey)

### ✅ Test 3: Časové okno 12h
**Vstup:** 2 články se stejným title, ale rozdíl > 12h
**Očekávání:** 2 samostatné karty (časové okno překročeno)

**Příklad:**
- Článek A: "Nehoda na D1", 13:00
- Článek B: "Nehoda na D1", 02:00 (následující den = >12h)

**Výstup:** 2 karty (časové okno překročeno)

### ✅ Test 4: Fallback na topic+section
**Vstup:** Článek s velmi krátkým title (< 10 znaků)
**Očekávání:** Použije se `topic||section` jako klíč

**Příklad:**
- Článek: "Novinky", topic: "aktualne", section: "aktualne"

**Výstup:** Klíč = `aktualne||aktualne`

### ✅ Test 5: Deduplikace sources
**Vstup:** 2 články se stejným title, oba mají stejný source (stejná URL)
**Očekávání:** 1 karta, sources obsahuje každý source jen jednou

**Příklad:**
- Článek A: sources: [{name: "ČT24", url: "..."}]
- Článek B: sources: [{name: "ČT24", url: "..."}] (stejná URL)

**Výstup:** 1 karta, sources: [{name: "ČT24", url: "..."}] (jen jednou)

---

## Expected Impact

### Méně karet
- Před: 100 článků → 100 karet
- Po: 100 článků → ~70-80 karet (odhad, závisí na duplicitách)

### Více zdrojů pod jednou kartou
- Před: Každá karta má 1-2 zdroje
- Po: Seskuplené karty mají 3-5 zdrojů (všechna média, která psala o tématu)

### Render zůstane beze změny
- `buildArticleHtml()` zůstává stejné
- `renderSourcesMetaLine()` už zobrazuje všechny zdroje z `sources[]`
- UI se automaticky přizpůsobí více zdrojům

---

## Varování: False Positives

### Riziko
Dva různé články se mohou seskupit, pokud:
1. Mají velmi podobný normalizovaný title
2. Jsou v časovém okně 12h

### Omezení
- **Časové okno 12h:** Omezuje seskupení na stejný den/událost
- **Normalizace title:** Konzervativní (neodstraňuje důležitá slova)
- **Fallback na topic+section:** Pro krátké titulky

### Monitoring
- Logovat `_groupMeta.relatedCount` pro debug
- Sledovat, zda se seskupují různé události
- V případě problémů: `ENABLE_TOPIC_GROUPING = false`

---

## Instalace

1. Zkopíruj feature flags (sekce A) na začátek `loadData()` nebo top-level scope
2. Zkopíruj pomocné funkce (sekce B) před `loadData()`
3. Zkopíruj `groupArticlesByTopic()` (sekce C) před `loadData()`
4. V `loadData()` najdi řádek 2320 (`const combined = buildCombinedFeed(...)`)
5. Vlož blok z sekce D **před** tento řádek
6. Změň `buildCombinedFeed(sanitizedArticles, ...)` na `buildCombinedFeed(articlesForFeed, ...)`
7. Otestuj podle checklistu (sekce F)

---

## Rollback

Pokud potřebuješ rychle vypnout seskupování:

```javascript
const ENABLE_TOPIC_GROUPING = false; // změnit na false
```

Kód zůstane, ale seskupování se neprovede.
