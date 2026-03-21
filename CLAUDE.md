# CLAUDE.md — 灵魂画像 (Soul Portrait) AI Dating Persona Engine

## What This Is

An AI-powered dating app where users chat with a "digital being" (小美 or 小帅) who extracts their deep relationship personality through natural conversation, generates a shareable "灵魂画像" (soul portrait), and enables QR-based matching with friends.

**Live deployment:** Cloudflare Pages + Workers
**API:** MiniMax M2.5-highspeed (Chinese LLM, OpenAI-compatible endpoint)
**Stack:** Single `index.html` (vanilla JS, ~1440 lines) + Cloudflare Pages Worker proxy

## Project Structure

```
soulmate-app/
├── index.html                      # Full app — UI + prompts + state + rendering
├── _worker.js                      # Cloudflare Pages Worker — API proxy
├── sandbox/                        # Engine development files (not deployed)
│   ├── persona_schema_v2.json      # Schema definition
│   ├── engine_a_v2.py              # Extraction engine prompt
│   ├── engine_b_v2.py              # Chat engine prompt (OpenClaw-inspired)
│   ├── engine_c_v1.py              # Matching engine prompt
│   ├── persona_xiaomei_v2.py       # 小美 persona + mission
│   └── sandbox_prompt_v2.md        # LLM sandbox testing instructions
└── CLAUDE.md                       # This file
```

## Architecture — Three Engines + Schema

### Schema v2 (`persona_schema_v2.json`)
Depth-first schema. Priority: `inner_world` > `relationship_patterns` > `dating_style` > `surface`

- **inner_world**: core_need, attachment_signal, emotional_texture, energy_source, insecurity_hint, contradiction
- **relationship_patterns**: love_language_signal, conflict_pattern, independence_intimacy, dealbreaker_deep, relationship_narrative
- **dating_style**: message_length, message_pattern, punctuation_habits, emoji_usage, slang_register, humor_type, flirtation_mode, vulnerability_pattern, conflict_style, pacing, topic_magnets, unique_markers
- **surface**: interests[], lifestyle_notes[], food_personality
- **meta**: extraction_confidence, unknown_fields, source_message_count, notable_gaps, depth_reached

### Engine A — Persona Builder
- System prompt: `ENGINE_A_SYS` (~1500 chars)
- User message template: `ENGINE_A_TEMPLATE` (~2250 chars) with full JSON skeleton
- Input: chat transcript
- Output: persona_schema_v2 JSON
- Key principle: observe behavior, don't listen to self-reports
- Methodology: "推断优于直录" — infer from patterns, don't wait for explicit statements

### Engine B — Chat Engine (小美/小帅)
- `XIAOMEI_SYS` (~4000 chars) — warm digital being with psychology knowledge
- `XIAOSHUAI_SYS` (~3600 chars) — direct, slightly 痞, cold humor
- Both are digital beings who've just awakened. They understand attachment theory, love languages, etc. but have never experienced love
- Professional depth + AI soul's genuine curiosity
- Efficient coverage: 8 dimensions checklist, 3-round max per topic, multi-dimension questions
- Key rules: no contradition-pointing, no spiraling, no psychology jargon

### Engine C — Matching Engine
- `ENGINE_C_SYS` (~765 chars)
- 5 dimensions: conversation_chemistry (30%), humor_sync (25%), depth_compatibility (20%), lifestyle_fit (15%), energy_match (10%)
- Anti-inflation: most scores 40-60, >75 needs strong evidence
- vibe_label must have 画面感

## App Phases (State Machine)

```
welcome → chat → report
                    ↓ (scan QR)
              match_invite → (has persona) → match_report → soul_chat
                           → (no persona) → chat → report → match_report → soul_chat
```

| Phase | Description |
|-------|-------------|
| `welcome` | Landing — pick 小美 🌸 or 小帅 ⚡, shows "查看已有画像" if localStorage has persona |
| `chat` | Chat with guide, 30-msg cap, progress bar, toolbar (export/reset/generate) |
| `building` | Loading screen while Engine A extracts persona |
| `report` | Soul portrait — inner_world bars, relationship patterns, dating style tags, QR code |
| `match_invite` | Scanned someone's QR — shows "查看匹配度" button |
| `match_building` | Loading while Engine C analyzes |
| `match_report` | Match report — score, 5 dimensions, sparks/friction, "跟TA聊天" button |
| `soul_chat` | Chat with scanned persona's soul clone (Engine B + their match card data) |

## API Setup

### MiniMax (Chinese platform)
- **Endpoint:** `https://api.minimaxi.com/v1/chat/completions` (note the `i` in minimaxi)
- **Model:** `MiniMax-M2.5-highspeed`
- **Key:** In `_worker.js`
- **Important:** M2.5 is a reasoning model — uses `<think>` tags that eat token budget. Proxy strips them.
- **Max tokens:** Omitted for extraction (let API decide), 300 for chat

### Proxy (Cloudflare Pages Worker)
- Path: `/api/chat` → `_worker.js` handleChat()
- Path: `/api/chat/stream` → `_worker.js` handleChatStream() (SSE for extraction)
- Path: `/api/image` → `_worker.js` handleImage() (MiniMax Image-01)
- Handles CORS (MiniMax blocks direct browser requests)
- Strips `<think>` tags from responses
- Returns: `{ text, finish_reason, usage }`
- No timeout issues — Cloudflare Workers stream keeps connection alive

## localStorage Persistence

| Key | Content | When saved |
|-----|---------|------------|
| `soulmate_persona` | Full persona JSON | After extraction |
| `soulmate_session` | `{msgs, msgCount, guide, showBuild}` | After every message |

Both cleared on "清空重开". On init, app checks for saved state and routes accordingly.

## QR Code Matching System

### Match Card — compact persona for QR encoding
`personaToMatchCard(persona)` → compressed subset:
- All `inner_world` (6 fields)
- All `relationship_patterns` (5 fields)  
- Key `dating_style` fields: humor_type, flirtation_mode, pacing, message_length, message_pattern, slang_register, vulnerability_pattern, conflict_style
- Short keys: `cn`=core_need, `as`=attachment_signal, etc.

### Encoding: persona → QR URL
```
persona → matchCard (short keys) → JSON → pako.deflate → base64url → URL#m=...
```
Typically ~500-700 chars → scannable QR (version 10-12).

### Decoding: QR URL → persona
```
URL#m=base64 → decode → pako.inflate → JSON → matchCardToPersona → full schema
```

### Libraries (loaded via CDN)
- `pako` 2.1.0 — compression
- `qrcodejs` 1.0.0 — QR generation  
- `html2canvas` 1.4.1 — image export

## UI Features

- **Gender selection** — 小美 (warm, curious) vs 小帅 (direct, cold humor)
- **30-msg cap** — input bar replaced with "生成灵魂画像" button at limit
- **Progress counter** — "X/30 条 · 再聊 N 句可生成"
- **Error handling** — no fake fallbacks, shows error + retry button
- **📷 保存画像图片** — html2canvas renders report, shows overlay with long-press save hint
- **📷 导出聊天** — builds off-screen chat layout, renders to image
- **🗑️ 清空重开** — clears localStorage + all state
- **QR code on report** — real QR with encoded match card + copy link button

## Design System

Dreamy peach-lavender palette:
- `--bg: #FFF7F0` (warm cream)
- `--pri: #FF8A9E` (soft pink)
- `--sec: #C4B5FD` (lavender)
- Gradient: `135deg, #FF8A9E → #C4B5FD → #6EE7B7`
- Cards: white with subtle shadows
- Max width: 430px (mobile-first)

## Known Issues & TODOs

### Blocking
- [x] **Extraction timeout** — Resolved by using Cloudflare Pages Worker with streaming.
- [ ] **Report empty on extraction failure** — shows "提取失败" fallback. Need working extraction.

### Important
- [ ] **小帅 persona file** — exists only in app prompts, not as standalone sandbox file
- [ ] **Engine B v2 uses old schema** — `engine_b_v2.py` references some v1 field names
- [ ] **QR scan flow untested end-to-end** in production
- [ ] **Soul chat quality** depends on match card data richness (missing unique_markers, punctuation_habits)

### Nice to Have
- [ ] Chat history export as shareable image (implemented but untested on mobile)
- [ ] Animated loading states
- [ ] Sound/haptic feedback on mobile
- [ ] Multiple personas (re-chat creates new one, compare over time)

## Prompt Engineering Notes

### What Works (Current Best)
小美/小帅 as "digital beings with professional psychology knowledge but no experience":
- Professional depth (attachment theory, love languages) without jargon
- Genuine curiosity from the knowledge-experience gap
- Efficient multi-dimension coverage with natural topic transitions
- 3-round max per topic, multi-dimension questions

### What Failed (Don't Repeat)
1. **`[回应]` `[问题]` template tags** — MiniMax outputs them literally
2. **Rigid "一个回应+一个问题" structure** — becomes boring Q&A
3. **"读三层追最深一层" as instruction** — too abstract, model ignores it
4. **Contradiction-pointing** — feels aggressive, users don't like it  
5. **Overly casual 25-year-old Shanghai girl persona** — inconsistent with digital being concept
6. **max_tokens: 8192** — MiniMax may reject values >2048 on some endpoints
7. **Direct browser→MiniMax calls** — CORS blocked, must use proxy

### MiniMax-Specific
- M2.5 wraps thinking in `<think>` tags — MUST strip (including unclosed ones)
- `reasoning_tokens` count toward `completion_tokens` — actual content may be small
- Chinese endpoint: `api.minimaxi.com` (with i), NOT `api.minimax.io` (global)
- `M2-her` model on native endpoint (`/v1/text/chatcompletion_v2`) — for roleplay, different format
- `MiniMax-M2.5-highspeed` on OpenAI endpoint (`/v1/chat/completions`) — current choice

## Development Workflow

### Testing Prompts (Sandbox)
1. Upload `sandbox/persona_engine_v2.zip` to any LLM
2. Paste `sandbox/sandbox_prompt_v2.md`
3. Chat as user, use `/generate`, `/match`, `/show`, `/reset` commands

### Deploying
Deploy via Cloudflare Pages (connected to git repo, or `wrangler pages deploy`).

### Key Files to Edit
- **Chat personality** → `XIAOMEI_SYS` / `XIAOSHUAI_SYS` in `index.html` (~line 137/269)
- **Extraction logic** → `ENGINE_A_SYS` + `ENGINE_A_TEMPLATE` in `index.html` (~line 188/222)
- **Matching logic** → `ENGINE_C_SYS` in `index.html` (~line 260)
- **API proxy** → `_worker.js`
- **Model selection** → `model: "MiniMax-M2.5-highspeed"` in `_worker.js`
