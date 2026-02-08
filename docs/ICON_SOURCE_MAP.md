# Mapování zdrojů → topic → ikona

## Cíl

Deterministická tabulka mapování zdrojů na ikony přes `config/sources.json` → `topic` → ikona.

**Poznámka**: Toto je specifikace pro budoucí implementaci. Ikony zatím nejsou implementované v render pipeline (`assets/app.js`).

## Priorita přiřazení

1. **P1**: `article.topic` (whitelist) → ikona (confidence 1.0)
2. **P2**: `sources[0].name` → `config/sources.json.topic` → ikona (confidence 0.99)
3. **P3**: `article.section` (whitelist) → ikona (confidence 0.98)

**Zakázáno**: Keyword matching z titulku, URL heuristiky, default ikony.

## Mapování topic → ikona

| Topic | Ikona | Poznámka |
|-------|-------|----------|
| `aktualne` | `time.svg` | Aktuálnost, průběh, breaking news |
| `sport` | `sport.svg` | Sportovní události |
| `finance` | `finance.svg` | Finanční zprávy |
| `zdravi` | `health.svg` | Zdravotnictví |
| `krimi` | `crime.svg` | Kriminalita |
| `doprava` | `traffic.svg` | Doprava |
| `pocasi` | `weather.svg` | Počasí |

## Příklad mapování

### P1: Přímá shoda topic
```json
{
  "topic": "sport",
  "section": "sport"
}
→ ikona: "sport.svg" (confidence: 1.0)
```

### P2: Zdroj s garantovanou rubrikou
```json
{
  "sources": [{"name": "ČT24", "url": "..."}],
  "topic": "aktualne"
}
→ config/sources.json: ČT24 má "topic": "aktualne"
→ ikona: "time.svg" (confidence: 0.99)
```

### P3: Fallback na section
```json
{
  "topic": null,
  "section": "sport"
}
→ ikona: "sport.svg" (confidence: 0.98)
```

## Žádná ikona

Ikona se **nezobrazí**, pokud:
- `topic` není v mapě (není whitelist hodnota)
- `topic` je prázdný nebo `null` a `section` také není v mapě
- Zdroj není v `config/sources.json` nebo nemá `topic`
- Confidence < 0.95

**Zásada**: Lepší žádná ikona než špatná ikona.
