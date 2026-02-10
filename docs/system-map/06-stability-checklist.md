# 06 – Stability checklist (před každým PR)

Tento checklist je povinný před jakoukoli změnou (kód, data, CSS, workflows).

## Pre-flight (repo stav)

- [ ] `git status --porcelain` je prázdné (žádné necommitnuté změny)
- [ ] `git fetch origin` + ověřeno, že base branch je aktuální
- [ ] pracuji na nové větvi (ne na `main`)

## Audit proti duplicitám (povinné grep/search)

- [ ] SW registrace / kill switch / cache:

```powershell
git grep -n -E 'serviceWorker|navigator\.serviceWorker|serviceWorker\.register|getRegistration|getRegistrations|unregister|caches\.' -- .
```

- [ ] data endpointy / paths:

```powershell
git grep -n -E 'projects/data|articles\.json|videos\.json|brief\.json|meta\.json|feed_health\.json|weather\.json|namedays\.json|_probe\.txt' -- .
```

- [ ] feed render orchestrace (anti „clear→append“):

```powershell
git grep -n -E 'loadData\(|buildCombinedFeed\(|replaceChildren\(' -- assets/app.js
git grep -n 'innerHTML' -- assets/app.js
```

- [ ] CLS guards / layout stabilizace:

```powershell
git grep -n -E 'scrollbar-gutter|min-height|content-visibility|contain:|transition:' -- assets/app.css
```

- [ ] init hooky (DOMContentLoaded / load / readyState):

```powershell
git grep -n -E 'DOMContentLoaded|document\.readyState' -- assets/app.js projects/index.html
git grep -n 'addEventListener("load"' -- assets/app.js projects/index.html
```

## Runtime sanity (před odesláním PR)

- [ ] první load: nic „nemizí“ a neskáče (hlavně feed a pravý sloupec)
- [ ] refresh: feed nejde na krátko na 0 položek (anti-regrese)
- [ ] konzole bez errorů (v debug módu `?debug=1` ověřit overlay metriky)

## Diff sanity

- [ ] `git diff` zkontrolovaný: žádné náhodné reformatování / reorder bez důvodu
- [ ] změny jsou minimální a izolované (jedno téma = jedna větev/PR)

## Povinný workflow (Branch → PR → ověření → merge)

- [ ] vytvořena větev
- [ ] commit message popisuje záměr („why“)
- [ ] push na origin
- [ ] PR do `main`
- [ ] checks zelené
- [ ] (až potom) merge + delete branch

