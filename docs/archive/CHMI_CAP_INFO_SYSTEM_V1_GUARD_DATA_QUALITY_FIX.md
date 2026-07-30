# CHMI CAP → iu-info-system-v1-guard data quality fix

## Root causes (reproduced on clean `origin/main`)

### `homepage_or_listing_url`
`scripts/chmi-cap-v2/normalize-feed.mjs` set `url` / `originalUrl` / `canonicalUrl` to
`https://vystrahy-cr.chmi.cz/` (public listing portal). Guard requires concrete item URLs
(`isConcreteItemUrl` rejects path `/`).

### `dup_canonical`
All CHMI cards shared that single listing URL as canonical → every pair collided.

### `chrono_missing`
CAP v2 normalize never emitted `sortAt`, `firstSeenByInfoUzel`, `lastProcessedAt`
(required by `scripts/iu-info-system-v1-guard.mjs`).

## Fix (pipeline, not guard weakening)

1. **URL** — primary link = official opendata CAP `.xml` document from discovery
   (`revision.sourceUrl`) + `?hid=<hazard_instance_id>` for per-hazard uniqueness.
   Portal listing stored only as `listingUrl` / `capV2.listingUrl` (not primary).
   Items without a concrete official document URL are not published as fake details.
2. **Canonical** — `canonicalUrl` = concrete CAP URL → unique per hazard.
3. **Chronology** — `publishedAtSource`/`sortAt` from CAP `sent`; `firstSeenByInfoUzel`
   preserved by stable item id across sync; `lastProcessedAt` = sync time.
4. **UI** — `chmiPublicDetailUrl` prefers concrete CAP document URL; never forces listing.
5. **Cache epoch** — `BULLETIN_CACHE_EPOCH = 3` forces regeneration of stale homepage items.

## Guard assertions corrected (stricter)

`chmi-cap-v2-guard` previously required homepage URLs and forbade `.xml` links.
That contradicted CAP architecture and `iu-info-system-v1-guard`. Assertions now require
concrete opendata CAP URLs, unique canonicals, and chrono fields.
