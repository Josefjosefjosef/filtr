/**
 * Traffic overview kill-switch flags — tiny module for CHMI-first boot graph.
 * Full traffic runtime loads lazily after first ČHMÚ paint.
 */
export const TRAFFIC_OVERVIEW_FLAGS = Object.freeze({
  PUBLICATION_ENABLED: false,
  PUBLIC_API_ENABLED: false,
  LIVE_NDIC_INGEST: false,
  TRAFFIC_UI_ENABLED: true,
  TRAFFIC_CARDS_RENDER: true,
  SEPARATE_TRAFFIC_HOME: false,
  SEPARATE_TRAFFIC_SETTINGS: false,
  SEPARATE_TRAFFIC_FILTERS: false,
  SEPARATE_TRAFFIC_LOCALITIES: false,
  PRODUCTION_DEPLOY: false,
});

export const TRAFFIC_UI_INITIAL_CARD_CAP = 0;
export const TRAFFIC_UI_FIRST_PAINT_CARD_CAP = 100;
