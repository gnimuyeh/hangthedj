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

-- ── LoveType Test Results ──
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

-- ── Custom Quizzes ──
CREATE TABLE IF NOT EXISTS quizzes (
  id          TEXT PRIMARY KEY,       -- short ID for URL (e.g. "a3x9k2")
  creator_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  dimensions  TEXT NOT NULL,          -- JSON array of dimension configs
  questions   TEXT NOT NULL,          -- JSON array of questions with scoring
  config      TEXT,                   -- JSON: accent color, tier labels, etc.
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quizzes_creator ON quizzes(creator_id);

-- ── Quiz Submissions (one per taker per quiz) ──
CREATE TABLE IF NOT EXISTS quiz_submissions (
  id          TEXT PRIMARY KEY,
  quiz_id     TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overall     INTEGER NOT NULL,       -- overall score 0-100
  scores      TEXT NOT NULL,          -- JSON: per-dimension scores
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(quiz_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_quiz ON quiz_submissions(quiz_id);
