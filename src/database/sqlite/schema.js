// Stable relational columns support indexed reads; per-record JSON retains the
// publisher/editorial extension fields without reducing the public data model.
export const SCHEMA_VERSION = 1;
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS storage_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS collections (
 name TEXT PRIMARY KEY, encoding TEXT NOT NULL, shape TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, digest TEXT NOT NULL DEFAULT '',
 item_count INTEGER NOT NULL DEFAULT 0, scalar TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE) STRICT;
CREATE TABLE IF NOT EXISTS feeds (
 collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
 row_key TEXT NOT NULL, position INTEGER NOT NULL, source_id INTEGER REFERENCES sources(id),
 title TEXT, category TEXT, payload TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(collection,row_key)
) STRICT;
CREATE INDEX IF NOT EXISTS feeds_order ON feeds(collection,position);
CREATE TABLE IF NOT EXISTS articles (
 collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
 row_key TEXT NOT NULL, position INTEGER NOT NULL, source_id INTEGER REFERENCES sources(id),
 link TEXT, normalized_link TEXT, article_id TEXT, cluster_id TEXT, title TEXT, category TEXT, region TEXT,
 published_at REAL, hotness REAL, payload TEXT NOT NULL, related INTEGER NOT NULL DEFAULT 0,
 digest TEXT NOT NULL, PRIMARY KEY(collection,row_key)
) STRICT;
CREATE INDEX IF NOT EXISTS articles_order ON articles(collection,position);
CREATE INDEX IF NOT EXISTS articles_link ON articles(collection,link);
CREATE INDEX IF NOT EXISTS articles_normalized_link ON articles(collection,normalized_link);
CREATE INDEX IF NOT EXISTS articles_category_date ON articles(collection,category,published_at DESC);
CREATE INDEX IF NOT EXISTS articles_source_date ON articles(collection,source_id,published_at DESC);
CREATE INDEX IF NOT EXISTS articles_cluster ON articles(cluster_id);
CREATE TABLE IF NOT EXISTS cluster_members (
 collection TEXT NOT NULL, cluster_key TEXT NOT NULL, position INTEGER NOT NULL,
 link TEXT, payload TEXT NOT NULL,
 PRIMARY KEY(collection,cluster_key,position),
 FOREIGN KEY(collection,cluster_key) REFERENCES articles(collection,row_key) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS cluster_members_link ON cluster_members(link);
CREATE TABLE IF NOT EXISTS rankings (
 collection TEXT NOT NULL, article_key TEXT NOT NULL, destination TEXT NOT NULL,
 rank INTEGER, score REAL, is_top INTEGER,
 PRIMARY KEY(collection,article_key),
 FOREIGN KEY(collection,article_key) REFERENCES articles(collection,row_key) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS rankings_destination ON rankings(destination,rank);
CREATE TABLE IF NOT EXISTS reading_states (
 collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
 row_key TEXT NOT NULL, position INTEGER NOT NULL, link TEXT, value TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(collection,row_key)
) STRICT;
CREATE INDEX IF NOT EXISTS reading_states_link ON reading_states(collection,link);
CREATE TABLE IF NOT EXISTS boards (
 collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
 row_key TEXT NOT NULL, position INTEGER NOT NULL, link TEXT, value TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(collection,row_key)
) STRICT;
CREATE INDEX IF NOT EXISTS boards_link ON boards(collection,link);
CREATE TABLE IF NOT EXISTS preferences (
 collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
 row_key TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(collection,row_key)
) STRICT;
CREATE TABLE IF NOT EXISTS metadata_entries (
 collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
 row_key TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(collection,row_key)
) STRICT;
CREATE INDEX IF NOT EXISTS metadata_order ON metadata_entries(collection,position);
CREATE TABLE IF NOT EXISTS maintenance_runs (kind TEXT PRIMARY KEY, completed_at INTEGER NOT NULL, detail TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS cache_files (
 path TEXT PRIMARY KEY, digest TEXT NOT NULL, bytes INTEGER NOT NULL,
 modified_at REAL NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
 version INTEGER, cached_at REAL, url TEXT, source_deleted INTEGER, deleted_detected_at TEXT, json TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS archive_entries (
 path TEXT NOT NULL REFERENCES cache_files(path) ON DELETE CASCADE, field TEXT NOT NULL,
 entry_key TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(path,field,entry_key)
) STRICT;
CREATE INDEX IF NOT EXISTS archive_entries_order ON archive_entries(path,field,position);
`;
