/**
 * infoUzel.cz — CLIENT article delivery config (P0 task 66)
 *
 * SERVER (aggregation, publication, Data Bot, RSS, DB) must never import this file.
 * CLIENT (browser feed UI) reads limits here — change limits without touching server pipeline.
 */

/** First open of a section: max articles fetched from server chunks (not DB cap). */
export const CLIENT_INITIAL_LIMIT = 100;

/** Each „Další“ click: max additional articles for the active section only. */
export const CLIENT_LOAD_MORE_LIMIT = 100;

/** Virtual Prehled dne loader key — no dedicated server section fetch. */
export const CLIENT_PREHLED_DNE_VIRTUAL_SECTION_KEY = "__prehled_dne_virtual__";

export const IU_ARTICLE_FEED_CHUNKS_DIR = "article_feed_chunks";
export const IU_HOMEPAGE_CHUNK_MANIFEST_FILE = "article_feed_chunks/manifest.json";

/** Chunk loader aliases (delivery layer only). */
export const IU_CHUNK_INITIAL_SIZE = CLIENT_INITIAL_LIMIT;
export const IU_CHUNK_BUFFER_MAX = CLIENT_INITIAL_LIMIT;
export const IU_CHUNK_LOAD_MORE_SIZE = CLIENT_LOAD_MORE_LIMIT;
export const IU_CHUNK_FILE_SIZE = CLIENT_LOAD_MORE_LIMIT;
