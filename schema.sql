-- LoveType D1 Schema
-- Run: wrangler d1 execute lovetype-db --file=schema.sql

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  device_id   TEXT UNIQUE NOT NULL,
  name        TEXT,
  phone       TEXT UNIQUE,
  avatar_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);

-- ── Test Results ──
CREATE TABLE IF NOT EXISTS results (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  test_type  TEXT NOT NULL,   -- 'lovetype' | 'compatibility'
  code       TEXT,            -- e.g. 'SLAO' for lovetype
  scores     TEXT NOT NULL,   -- JSON of dimension scores
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id);
CREATE INDEX IF NOT EXISTS idx_results_type ON results(test_type);
