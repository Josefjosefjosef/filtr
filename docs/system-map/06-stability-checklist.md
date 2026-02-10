# 06 – Stability checklist (před každým PR)

Tento checklist je povinný před jakoukoli změnou (kód, data, CSS, workflows).

## Pre-flight (repo stav)

- [ ] `git status --porcelain` je prázdné (žádné necommitnuté změny)
- [ ] `git fetch origin` + ověřeno, že base branch je aktuální
- [ ] pracuji na nové větvi (ne na `main`)

## Audit proti duplicitám (povinné grep/search)

Pozn.: pokud není `rg` v PATH, použij ekvivalent přes `git grep`.

- [ ] SW registrace / kill switch / cache:

```bash
git grep -n -E "serviceWorker|navigator\.serviceWorker|register\(" -- .
```

- [ ] data endpointy / paths:

```bash
git grep -n -E "projects/data|articles\.json|videos\.json|weather\.json|namedays\.json" -- .
```

- [ ] feed render orchestrace (anti „clear→append“):

```bash
git grep -n -E "loadData\(|buildCombinedFeed\(|replaceChildren\(|innerHTML\s*=\s*\"\"" -- assets/app.js
```

- [ ] CLS guards / layout stabilizace:

```bash
git grep -n -E "scrollbar-gutter|min-height|contain|content-visibility|transition:\s*none" -- assets/app.css
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

