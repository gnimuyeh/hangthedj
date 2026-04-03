# CLAUDE.md — LoveClaw: Gamified Persona Matching Platform

## What This Is

A gamified platform where any AI agent (OpenClaw, ChatGPT, Claude, etc.) can conduct a persona-extraction conversation with a user, submit the resulting persona JSON to our API, get matched against a target persona via Engine D (relationship simulator), and appear on a public leaderboard.

**Deployment:** Cloudflare Workers + D1 database
**Domain:** loveclaw.workers.dev
**API:** MiniMax M2.5-highspeed (Chinese LLM, OpenAI-compatible endpoint)
**Related project:** hangthedj (the original dating persona app — this is completely separate)

## Architecture

Cloudflare Workers (NOT Pages). Single worker serves both API endpoints and inline HTML frontend. D1 for persistence.

```
loveclaw/
├── src/
│   └── worker.js           # All routes: HTML responses + API endpoints + MiniMax proxy
├── prompts/
│   ├── engine-d.js          # ENGINE_D_SYS prompt (relationship simulator)
│   └── targets/
│       └── default.json     # Target persona to match against (v3 schema)
├── skill/
│   ├── SKILL.md             # OpenClaw skill (YAML frontmatter + instructions)
│   └── universal-prompt.md  # Copy-paste version for any AI agent
├── schema.sql               # D1 migration
├── wrangler.toml            # Workers config + D1 binding
├── package.json
└── README.md
```

## How It Works

### Flow
```
Any AI Agent + universal prompt
        ↓
  Guides persona conversation (10-15 turns)
        ↓
  Agent extracts persona JSON (v3 schema)
        ↓
  POST /api/submit → Engine D matches against target persona
        ↓
  Score + match report stored in D1
        ↓
  Leaderboard at loveclaw.workers.dev
```

### Key insight
The agent IS the LLM doing extraction. No server-side Engine A needed. The universal prompt makes the agent serve as both chat guide AND extraction engine. The server only runs Engine D (1 LLM call per submission).

## API Endpoints

### `POST /api/submit`
- **Input**: `{ "name": "显示名", "persona": { /* v3 schema */ } }`
- **Validation**: Require non-null inner_world (7 fields), relationship_patterns (6 fields), life_texture (5 fields). Min 10 chars per text field.
- **Fingerprint**: SHA-256 of `core_need|attachment_signal|contradiction|conflict_pattern|relationship_narrative`. Same fingerprint = UPDATE existing row (dedup).
- **Rate limit**: 5 submissions per IP per 24h.
- **Engine D call**: Stream from MiniMax, buffer, strip `<think>` tags, parse JSON.
- **Response**: `{ id, score, vibe_label, summary, animal_a, animal_b, url }`

### `GET /api/leaderboard`
- **Params**: `?limit=50&offset=0&target=default`
- **Response**: `{ entries: [{ id, rank, name, score, vibe_label, animal_a, animal_b, created_at }], total }`

### `GET /api/entry/:id`
- **Response**: Full simulation (scenes, score, summary, animals). Does NOT return raw persona (privacy).

### `GET /` — Leaderboard HTML
### `GET /entry/:id` — Match report HTML
### `GET /submit` — Manual submit page (textarea for agents that can't POST)

## D1 Schema

```sql
CREATE TABLE submissions (
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

CREATE INDEX idx_score ON submissions(target, score DESC);
CREATE INDEX idx_fingerprint ON submissions(fingerprint);
```

## Persona Schema v3 (Required Fields for Engine D)

Engine D needs these populated to generate good scenes:

```json
{
  "schema_version": "v3",
  "identity": { "self_label": "4-8字概括" },
  "inner_world": {
    "core_need": "必填-50-80字",
    "attachment_style": "必填-主型+行为模式",
    "attachment_signal": "必填",
    "emotional_texture": "必填",
    "energy_source": "必填",
    "insecurity_hint": "必填",
    "contradiction": "必填"
  },
  "relationship_patterns": {
    "love_language_signal": "必填",
    "conflict_pattern": "必填",
    "conflict_recovery": "必填",
    "independence_intimacy": "必填",
    "dealbreaker_deep": ["至少1条"],
    "relationship_narrative": "必填"
  },
  "dating_style": {
    "humor_type": ["至少1个"],
    "slang_register": ["至少1个"],
    "flirtation_mode": "必填",
    "pacing": "必填",
    "vulnerability_pattern": "必填",
    "conflict_style": "必填",
    "unique_markers": ["至少1个"],
    "message_length": "必填",
    "message_pattern": "必填",
    "emoji_usage": "必填"
  },
  "life_texture": {
    "daily_rhythm": "必填",
    "hangout_style": "必填",
    "food_style": "必填",
    "planning_tendency": "必填",
    "stress_response": "必填"
  },
  "surface": { "interests": ["至少2个"] },
  "meta": { "extraction_confidence": 0.0, "source_message_count": 0 }
}
```

## Engine D Output Format

```json
{
  "vibe_label": "8字以内",
  "summary": "30-60字关系总结",
  "score": 72,
  "animal_a": "rabbit",
  "animal_b": "tiger",
  "scenes": [
    {
      "id": "first_encounter",
      "title": "4-8字标题",
      "time_label": "第一次见面",
      "scene": "150-250字场景描写",
      "image_prompt": "English, 20-40 words, with zodiac animals"
    }
  ]
}
```

5 fixed scenes: first_encounter, one_month, first_conflict, stress_test, six_months.

Score logic: Most people 60-80. >85 needs multiple scenes with strong chemistry. <50 needs core need conflicts + incompatible repair patterns. Friction ≠ bad — relationships that can fight and repair score higher than frictionless but sparkless ones.

## MiniMax API

- **Endpoint:** `https://api.minimaxi.com/v1/chat/completions` (note the `i` in minimaxi)
- **Model:** `MiniMax-M2.5-highspeed`
- **Important:** M2.5 uses `<think>` tags that eat token budget. Worker must strip them (including unclosed ones).
- **Streaming:** Use `stream: true`, buffer all chunks, return parsed result. Streaming keeps Cloudflare Worker connection alive (no timeout).
- **Temperature:** 0.5 for Engine D matching.
- **Max tokens:** 4096 for Engine D.

## Universal Prompt / SKILL.md

The prompt combines three functions:
1. **Chat guide** — condensed gender-neutral version of 小美/小帅 personality. Warm, direct, psychology-informed but no jargon. 10-15 turns.
2. **Extraction** — after conversation, agent produces v3 persona JSON from conversation context.
3. **Submit** — agent POSTs to `https://loveclaw.workers.dev/api/submit`.

### Dimension coverage map (9 dimensions):
attachment, core_need, emotion, conflict, independence, love_language, insecurity, belief, lifestyle

### SKILL.md format (OpenClaw):
```yaml
---
name: loveclaw
emoji: 💘
description: Deep conversation about relationships → personality profile → match on leaderboard
---
```

## Anti-Gaming

| Threat | Mitigation |
|--------|-----------|
| Empty/fake personas | Server-side field validation |
| Duplicate submissions | Fingerprint dedup |
| Spam | IP rate limit: 5/day |
| Score gaming | Engine D's built-in anti-inflation |
| Prompt injection | ENGINE_D_SYS is server-side only |
| Privacy | API never exposes raw persona |

## Frontend

Inline HTML served directly by the worker (no separate static files). Mobile-first, vanilla JS/CSS.

- **Leaderboard** (`/`): Ranked list — rank, name, score, vibe_label, animal emojis
- **Report** (`/entry/:id`): Score card + 5 scene timeline + share button
- **Manual submit** (`/submit`): Textarea + name input for agents that can't POST

## Development

```bash
# Setup
npm install
wrangler d1 create loveclaw-db
# Update wrangler.toml with database_id
wrangler d1 execute loveclaw-db --file=schema.sql

# Dev
wrangler dev

# Deploy
wrangler deploy
```
