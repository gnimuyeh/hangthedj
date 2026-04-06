# CLAUDE.md — LoveType

## What This Is

LoveType is a relationship personality test platform. Users take quizzes to discover their relationship style (16 types across 4 dimensions), create custom compatibility quizzes to share with others, and chat with an AI to generate a deep relationship persona.

**Live:** https://hangthedj.pages.dev
**Stack:** Cloudflare Pages (Advanced Mode) + D1 + MiniMax LLM
**LLM API:** MiniMax M2.5-highspeed

## Project Structure

```
├── _worker.js              # Cloudflare Worker — API routes (source of truth)
├── wrangler.toml            # Pages config — D1 binding
├── schema.sql               # D1 database schema
├── public/                  # Static assets (served by Pages)
│   ├── _worker.js           # Copy of root _worker.js (Pages Advanced Mode requires this)
│   ├── index.html           # Landing page — name gate + feature cards
│   ├── lovetype-test.html   # Feature 1: 恋爱人格测试 (16-type personality test)
│   ├── create.html          # Feature 2: 创建专属灵魂测试 (AI quiz generator)
│   ├── quiz.html            # Feature 2: Quiz template (data-driven, loads from /api/quiz/:id)
│   ├── soulmate.html        # Feature 3: AI灵魂画像 (deep conversation persona)
│   └── jason/index.html     # Feature 4: 恋爱契合度测试 (13-dimension compatibility)
├── CLAUDE.md
└── .gitignore
```

## Features

| # | Name | Path | Description |
|---|------|------|-------------|
| 1 | 恋爱人格测试 | `/lovetype-test.html` | 32/60 question quiz → 16 types across 4 dimensions (S/N, L/E, A/R, O/C) |
| 2 | 创建专属灵魂测试 | `/create.html` → `/quiz/:id` | AI interview → generates custom compatibility quiz → shareable link |
| 3 | AI灵魂画像 | `/soulmate.html` | Chat with AI (小美/小帅) → extracts deep relationship persona |
| 4 | 恋爱契合度测试 | `/jason/` | Fixed 13-dimension compatibility quiz (33 scenario questions) |

## Architecture

### Backend (`_worker.js`)

Router → middleware → handler pattern.

**Helpers:** `json()`, `err()`, `callMiniMax()`, `bufferMiniMaxStream()`, `stripThinkTags()`

**Middleware:** `handleCORS()`, `requirePOST()`, `getUser()` (device-based), `requireDevice()`

**Routes:**
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | /api/chat | handleChat | MiniMax buffered proxy |
| POST | /api/chat/stream | handleChatStream | MiniMax SSE relay |
| POST | /api/image | handleImage | MiniMax image generation |
| GET | /api/auth/me | handleMe | Get current device user |
| POST | /api/auth/name | handleSetName | Set user display name |
| POST | /api/results | handleSaveResult | Save test result (lovetype/soulmate) |
| GET | /api/results | handleGetResults | Get user's result history |
| POST | /api/quiz/generate | handleQuizGenerate | AI generates quiz from interview transcript |
| GET | /api/quiz/:id | handleQuizGet | Fetch quiz config (dimensions + questions) |
| POST | /api/quiz/:id/submit | handleQuizSubmit | Save taker's result (one per device per quiz) |
| GET | /api/quiz/:id/submissions | handleQuizSubmissions | Creator views all submissions |
| GET | /api/quiz/:id/my-result | handleQuizMyResult | Check if device already submitted |

### Database (D1)

```
users:            id, device_id (unique), name, phone, avatar_url
results:          id, user_id, test_type ('lovetype'|'soulmate'), code, scores (JSON)
quizzes:          id, creator_id, title, description, dimensions (JSON), questions (JSON), config (JSON)
quiz_submissions: id, quiz_id, user_id, overall, scores (JSON), UNIQUE(quiz_id, user_id)
```

### Auth

Device-based identity. No login required.
- `lovetype_device_id` in localStorage → auto-creates user row in D1 on first API call
- `lovetype_user_name` in localStorage → name gate on landing page, shared across all features
- `X-Device-Id` header sent on all API calls

### Design System

- Background: `#FAFAF7` (warm cream)
- Accent: `#C76D2E` (warm brown)
- Secondary: `#E8A86B` (warm gold)
- Text: `#111` / `#777` (sub) / `#aaa` (muted)
- Cards: `rgba(255,255,255,0.92)` with `1px solid rgba(0,0,0,0.06)`
- Border radius: 14px (cards), 10px (buttons)
- Font: PingFang SC / Noto Sans SC

### MiniMax API

- **Endpoint:** `https://api.minimaxi.com/v1/chat/completions` (note the `i` in minimaxi)
- **Model:** `MiniMax-M2.5-highspeed`
- **Key:** In `_worker.js` as `MINIMAX_KEY`
- **Quirk:** M2.5 wraps reasoning in `<think>` tags — must strip them
- **Streaming:** Always use `stream: true`, buffer or relay via SSE

## Development

```bash
# Local dev
wrangler dev

# Deploy (Pages)
wrangler pages deploy public --project-name=hangthedj --branch=main

# D1 migration
wrangler d1 execute lovetype-db --remote --file=schema.sql
```

**Important:** After editing `_worker.js`, always copy to `public/_worker.js` before deploying:
```bash
cp _worker.js public/_worker.js
```

## Adding New API Routes

```js
async function handleMyRoute(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);
  // user.id, user.device_id, user.name available
  return json({ result: "ok" });
}

// Register in route table:
const routes = {
  // ...existing...
  "POST /api/my-route": handleMyRoute,
};
```

---

## TODO: SPA Migration Plan

### Problem

The app currently has 4 features as separate HTML files (~200KB total). Each is a standalone React app with its own styles, state, and CDN imports. This causes:
- Duplicated React/Babel CDN loads on every page
- Duplicated device ID / auth helpers in each file
- No shared state between features
- No shared navigation/header component
- `soulmate.html` uses vanilla DOM (`h()` helper) while the rest use React JSX — fundamentally different rendering

### Target Architecture

Single `index.html` SPA with hash-based routing. All features as React components within one app.

```
public/
├── index.html          # Single entry point — React SPA
└── _worker.js          # Worker (unchanged)
```

```
Route               → Component
#/                  → Landing (name gate + feature cards + returning user result)
#/test              → LoveTypeTest (32/60 question personality quiz)
#/create            → QuizCreator (AI interview chat → generate quiz)
#/quiz/:id          → QuizTaker (data-driven quiz template)
#/soulmate          → Soulmate (AI conversation → persona)
#/jason             → JasonQuiz (13-dimension compatibility)
```

### Shared Infrastructure (extract once, used by all)

```js
// Auth context
const AuthContext = React.createContext();
function AuthProvider({ children }) {
  const [user, setUser] = useState({ deviceId: getDeviceId(), name: getUserName() });
  // ... shared auth state
}

// API helpers
function apiHeaders() { return { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() }; }
function api(path, opts) { return fetch(path, { ...opts, headers: { ...apiHeaders(), ...opts?.headers } }); }

// Router
function Router() {
  const [route, setRoute] = useState(window.location.hash || '#/');
  useEffect(() => { window.addEventListener('hashchange', () => setRoute(window.location.hash)); }, []);
  // match route → render component
}

// Shared components
function Header({ title, back }) { ... }  // consistent nav with ← back to home
function Card({ icon, title, desc, meta, href }) { ... }  // landing page card
function ProgressBar({ current, total }) { ... }  // quiz progress
function QuizQuestion({ question, onPick }) { ... }  // shared question UI
```

### Migration Steps

**Step 1: Scaffold** — Create single `index.html` with hash router, AuthProvider, shared components. Landing page renders from new file.

**Step 2: Migrate LoveType Test** — Extract the `DIMS`, `LETTERS`, `GRP`, `TP`, `QS` data + `calc()` + `compat()` functions + `App` component from `lovetype-test.html` into a `LoveTypeTest` component within the SPA. This is the cleanest migration since it's already React.

**Step 3: Migrate Quiz Creator + Quiz Taker** — `create.html` and `quiz.html` are already React. Extract as `QuizCreator` and `QuizTaker` components. Move prompts to shared constants.

**Step 4: Migrate Jason Quiz** — `jason/index.html` is React. Extract `DIMS`, `QS`, `calcResult`, `App` as `JasonQuiz` component.

**Step 5: Migrate Soulmate** — This is the hardest. `soulmate.html` uses vanilla DOM with a custom `h()` helper and manual `render()` loop (not React). Two options:
  - **Option A: Rewrite as React** — significant effort (~2000 lines), but results in clean architecture
  - **Option B: Wrap in React** — mount the vanilla app inside a React component via `useRef` + `useEffect`. Hacky but fast.
  - **Recommendation: Option A** — the soulmate app has the most complex state (chat, personas, matching, reports). It benefits the most from React's state management.

**Step 6: Remove old files** — Delete all individual HTML files. Update `_worker.js` to only serve `index.html` for all non-API routes (SPA fallback).

**Step 7: Deduplicate** — Shared quiz question component (used by lovetype, jason, quiz taker), shared result display, shared image export (html2canvas), shared chat interface (used by soulmate and quiz creator).

### Size Estimate

Current total: ~200KB across 5 HTML files (includes duplicated React/Babel CDN references and repeated style blocks).
After migration: ~150KB single file (deduplication savings) + one set of CDN loads.

### Risk

- Soulmate rewrite is ~2000 lines of vanilla DOM → React conversion
- Large single file may be unwieldy — consider splitting into multiple `<script type="text/babel">` blocks within the same HTML, one per feature
- In-browser Babel compilation of a large file may be slow on low-end devices — monitor performance, consider a build step (Vite) if it becomes a problem
