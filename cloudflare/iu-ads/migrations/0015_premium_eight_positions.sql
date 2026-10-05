-- Premium catalog P1-P8 + new price list (P1=5990 CZK, step -300 CZK per position)
PRAGMA foreign_keys = OFF;

CREATE TABLE premium_selected_categories_new (
  category_slug TEXT PRIMARY KEY,
  premium_capacity INTEGER NOT NULL DEFAULT 8 CHECK (premium_capacity IN (2, 4, 8)),
  p2_first_published_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO premium_selected_categories_new
  SELECT category_slug, premium_capacity, p2_first_published_at, updated_at
FROM premium_selected_categories;

DROP TABLE premium_selected_categories;
ALTER TABLE premium_selected_categories_new RENAME TO premium_selected_categories;
UPDATE premium_selected_categories
SET premium_capacity = 8, updated_at = datetime('now')
WHERE premium_capacity IN (2, 4);

CREATE TABLE premium_selected_placements_new (
  placement_id TEXT PRIMARY KEY,
  category_slug TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8),
  current_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CZK',
  active_campaign_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_slug) REFERENCES premium_selected_categories(category_slug)
);

INSERT INTO premium_selected_placements_new
  (placement_id, category_slug, position, current_price_cents, currency, active_campaign_id, updated_at)
SELECT placement_id, category_slug, position, current_price_cents, currency, active_campaign_id, updated_at
FROM premium_selected_placements;

UPDATE premium_selected_placements_new SET current_price_cents = 569000, updated_at = datetime('now') WHERE position = 2;
UPDATE premium_selected_placements_new SET current_price_cents = 539000, updated_at = datetime('now') WHERE position = 3;
UPDATE premium_selected_placements_new SET current_price_cents = 509000, updated_at = datetime('now') WHERE position = 4;

INSERT OR IGNORE INTO premium_selected_placements_new
  (placement_id, category_slug, position, current_price_cents, currency, active_campaign_id, updated_at)
VALUES
  ('selected_services.aff-cestovni-kancelare.premium.05', 'aff-cestovni-kancelare', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-kancelare.premium.06', 'aff-cestovni-kancelare', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-kancelare.premium.07', 'aff-cestovni-kancelare', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-kancelare.premium.08', 'aff-cestovni-kancelare', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-ubytovani-hotely.premium.05', 'aff-ubytovani-hotely', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-ubytovani-hotely.premium.06', 'aff-ubytovani-hotely', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-ubytovani-hotely.premium.07', 'aff-ubytovani-hotely', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-ubytovani-hotely.premium.08', 'aff-ubytovani-hotely', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky.premium.05', 'aff-letenky', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky.premium.06', 'aff-letenky', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky.premium.07', 'aff-letenky', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky.premium.08', 'aff-letenky', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky-letecka-doprava.premium.05', 'aff-letenky-letecka-doprava', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky-letecka-doprava.premium.06', 'aff-letenky-letecka-doprava', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky-letecka-doprava.premium.07', 'aff-letenky-letecka-doprava', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-letenky-letecka-doprava.premium.08', 'aff-letenky-letecka-doprava', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-pojisteni.premium.05', 'aff-cestovni-pojisteni', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-pojisteni.premium.06', 'aff-cestovni-pojisteni', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-pojisteni.premium.07', 'aff-cestovni-pojisteni', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-cestovni-pojisteni.premium.08', 'aff-cestovni-pojisteni', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-auto-moto.premium.05', 'aff-auto-moto', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-auto-moto.premium.06', 'aff-auto-moto', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-auto-moto.premium.07', 'aff-auto-moto', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-auto-moto.premium.08', 'aff-auto-moto', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pneu-pneuservis.premium.05', 'aff-pneu-pneuservis', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pneu-pneuservis.premium.06', 'aff-pneu-pneuservis', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pneu-pneuservis.premium.07', 'aff-pneu-pneuservis', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pneu-pneuservis.premium.08', 'aff-pneu-pneuservis', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pojisteni.premium.05', 'aff-pojisteni', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pojisteni.premium.06', 'aff-pojisteni', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pojisteni.premium.07', 'aff-pojisteni', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-pojisteni.premium.08', 'aff-pojisteni', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-finance.premium.05', 'aff-finance', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-finance.premium.06', 'aff-finance', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-finance.premium.07', 'aff-finance', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-finance.premium.08', 'aff-finance', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-energie-uspor.premium.05', 'aff-energie-uspor', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-energie-uspor.premium.06', 'aff-energie-uspor', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-energie-uspor.premium.07', 'aff-energie-uspor', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-energie-uspor.premium.08', 'aff-energie-uspor', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-lekarny.premium.05', 'aff-lekarny', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-lekarny.premium.06', 'aff-lekarny', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-lekarny.premium.07', 'aff-lekarny', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-lekarny.premium.08', 'aff-lekarny', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zdravi-doplnky.premium.05', 'aff-zdravi-doplnky', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zdravi-doplnky.premium.06', 'aff-zdravi-doplnky', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zdravi-doplnky.premium.07', 'aff-zdravi-doplnky', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zdravi-doplnky.premium.08', 'aff-zdravi-doplnky', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kosmetika.premium.05', 'aff-kosmetika', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kosmetika.premium.06', 'aff-kosmetika', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kosmetika.premium.07', 'aff-kosmetika', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kosmetika.premium.08', 'aff-kosmetika', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-drogerie.premium.05', 'aff-drogerie', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-drogerie.premium.06', 'aff-drogerie', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-drogerie.premium.07', 'aff-drogerie', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-drogerie.premium.08', 'aff-drogerie', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-moda.premium.05', 'aff-moda', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-moda.premium.06', 'aff-moda', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-moda.premium.07', 'aff-moda', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-moda.premium.08', 'aff-moda', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-boty.premium.05', 'aff-boty', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-boty.premium.06', 'aff-boty', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-boty.premium.07', 'aff-boty', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-boty.premium.08', 'aff-boty', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-deti-hracky.premium.05', 'aff-deti-hracky', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-deti-hracky.premium.06', 'aff-deti-hracky', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-deti-hracky.premium.07', 'aff-deti-hracky', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-deti-hracky.premium.08', 'aff-deti-hracky', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sportovni-obleceni.premium.05', 'aff-sportovni-obleceni', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sportovni-obleceni.premium.06', 'aff-sportovni-obleceni', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sportovni-obleceni.premium.07', 'aff-sportovni-obleceni', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sportovni-obleceni.premium.08', 'aff-sportovni-obleceni', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sport-outdoor.premium.05', 'aff-sport-outdoor', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sport-outdoor.premium.06', 'aff-sport-outdoor', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sport-outdoor.premium.07', 'aff-sport-outdoor', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sport-outdoor.premium.08', 'aff-sport-outdoor', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dum-zahrada.premium.05', 'aff-dum-zahrada', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dum-zahrada.premium.06', 'aff-dum-zahrada', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dum-zahrada.premium.07', 'aff-dum-zahrada', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dum-zahrada.premium.08', 'aff-dum-zahrada', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-nabytek.premium.05', 'aff-nabytek', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-nabytek.premium.06', 'aff-nabytek', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-nabytek.premium.07', 'aff-nabytek', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-nabytek.premium.08', 'aff-nabytek', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kuchyn.premium.05', 'aff-kuchyn', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kuchyn.premium.06', 'aff-kuchyn', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kuchyn.premium.07', 'aff-kuchyn', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kuchyn.premium.08', 'aff-kuchyn', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-elektro.premium.05', 'aff-elektro', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-elektro.premium.06', 'aff-elektro', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-elektro.premium.07', 'aff-elektro', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-elektro.premium.08', 'aff-elektro', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-mobily.premium.05', 'aff-mobily', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-mobily.premium.06', 'aff-mobily', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-mobily.premium.07', 'aff-mobily', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-mobily.premium.08', 'aff-mobily', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-software.premium.05', 'aff-software', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-software.premium.06', 'aff-software', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-software.premium.07', 'aff-software', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-software.premium.08', 'aff-software', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-knihy.premium.05', 'aff-knihy', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-knihy.premium.06', 'aff-knihy', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-knihy.premium.07', 'aff-knihy', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-knihy.premium.08', 'aff-knihy', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-jidlo.premium.05', 'aff-jidlo', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-jidlo.premium.06', 'aff-jidlo', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-jidlo.premium.07', 'aff-jidlo', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-jidlo.premium.08', 'aff-jidlo', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zvirata.premium.05', 'aff-zvirata', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zvirata.premium.06', 'aff-zvirata', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zvirata.premium.07', 'aff-zvirata', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-zvirata.premium.08', 'aff-zvirata', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kvetiny-darky.premium.05', 'aff-kvetiny-darky', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kvetiny-darky.premium.06', 'aff-kvetiny-darky', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kvetiny-darky.premium.07', 'aff-kvetiny-darky', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kvetiny-darky.premium.08', 'aff-kvetiny-darky', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sperky-hodinky.premium.05', 'aff-sperky-hodinky', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sperky-hodinky.premium.06', 'aff-sperky-hodinky', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sperky-hodinky.premium.07', 'aff-sperky-hodinky', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-sperky-hodinky.premium.08', 'aff-sperky-hodinky', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-tv-streamovani.premium.05', 'aff-tv-streamovani', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-tv-streamovani.premium.06', 'aff-tv-streamovani', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-tv-streamovani.premium.07', 'aff-tv-streamovani', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-tv-streamovani.premium.08', 'aff-tv-streamovani', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dilna-naradi.premium.05', 'aff-dilna-naradi', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dilna-naradi.premium.06', 'aff-dilna-naradi', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dilna-naradi.premium.07', 'aff-dilna-naradi', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-dilna-naradi.premium.08', 'aff-dilna-naradi', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-inzerce-bazary.premium.05', 'aff-inzerce-bazary', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-inzerce-bazary.premium.06', 'aff-inzerce-bazary', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-inzerce-bazary.premium.07', 'aff-inzerce-bazary', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-inzerce-bazary.premium.08', 'aff-inzerce-bazary', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-realitni-kancelare.premium.05', 'aff-realitni-kancelare', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-realitni-kancelare.premium.06', 'aff-realitni-kancelare', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-realitni-kancelare.premium.07', 'aff-realitni-kancelare', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-realitni-kancelare.premium.08', 'aff-realitni-kancelare', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-reality-nemovitosti.premium.05', 'aff-reality-nemovitosti', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-reality-nemovitosti.premium.06', 'aff-reality-nemovitosti', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-reality-nemovitosti.premium.07', 'aff-reality-nemovitosti', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-reality-nemovitosti.premium.08', 'aff-reality-nemovitosti', 8, 389000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kancelarske-potreby.premium.05', 'aff-kancelarske-potreby', 5, 479000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kancelarske-potreby.premium.06', 'aff-kancelarske-potreby', 6, 449000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kancelarske-potreby.premium.07', 'aff-kancelarske-potreby', 7, 419000, 'CZK', NULL, datetime('now')),
  ('selected_services.aff-kancelarske-potreby.premium.08', 'aff-kancelarske-potreby', 8, 389000, 'CZK', NULL, datetime('now'));

DROP TABLE premium_selected_placements;
ALTER TABLE premium_selected_placements_new RENAME TO premium_selected_placements;
CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_selected_placements_cat_pos
  ON premium_selected_placements(category_slug, position);

CREATE TABLE premium_selected_orders_new (
  order_id TEXT PRIMARY KEY,
  placement_id TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8),
  workflow_status TEXT NOT NULL DEFAULT 'submitted',
  target_url TEXT,
  creative_id TEXT,
  creative_mode TEXT,
  published_campaign_id TEXT,
  published_at TEXT,
  publish_idempotency_key TEXT,
  order_token_hash TEXT NOT NULL,
  client_contact_email TEXT,
  note_client TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id),
  FOREIGN KEY (placement_id) REFERENCES premium_selected_placements(placement_id)
);

INSERT INTO premium_selected_orders_new SELECT * FROM premium_selected_orders;
DROP TABLE premium_selected_orders;
ALTER TABLE premium_selected_orders_new RENAME TO premium_selected_orders;
CREATE INDEX IF NOT EXISTS idx_premium_selected_orders_status ON premium_selected_orders(workflow_status);
CREATE INDEX IF NOT EXISTS idx_premium_selected_orders_placement ON premium_selected_orders(placement_id);

PRAGMA foreign_keys = ON;

UPDATE system_settings SET value = '0015', updated_at = datetime('now') WHERE key = 'SCHEMA_VERSION';
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('SCHEMA_VERSION', '0015', datetime('now'));
