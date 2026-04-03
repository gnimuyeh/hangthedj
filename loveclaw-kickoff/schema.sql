-- LoveClaw D1 Schema
-- Run: wrangler d1 execute loveclaw-db --file=schema.sql

CREATE TABLE IF NOT EXISTS submissions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  persona     TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT 'default',
  score       INTEGER NOT NULL,
  vibe_label  TEXT NOT NULL,
  summary     TEXT NOT NULL,
  animal_a    TEXT,
  animal_b    TEXT,
  simulation  TEXT NOT NULL,
  fingerprint TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_score ON submissions(target, score DESC);
CREATE INDEX IF NOT EXISTS idx_fingerprint ON submissions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_created ON submissions(created_at DESC);
