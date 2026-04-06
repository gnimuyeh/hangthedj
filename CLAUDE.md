# CLAUDE.md — LoveType

## What This Is

LoveType is a relationship personality test platform. Users take quizzes to discover their relationship style (16 types across 4 dimensions) and test compatibility with others.

**Live:** https://hangthedj.yuming-p-he.workers.dev
**Stack:** Cloudflare Workers + D1 + Static Assets
**LLM API:** MiniMax M2.5-highspeed (for future AI features)

## Project Structure

```
├── _worker.js              # Cloudflare Worker — API routes + static asset serving
├── wrangler.toml            # Workers config — D1 binding, static assets
├── schema.sql               # D1 database migration
├── public/                  # Static assets (served by Workers Static Assets)
│   ├── index.html           # Landing page — nav to tests
│   ├── lovetype-test.html   # 恋爱人格测试 (personality test, 32/60 questions)
│   └── compatibility-quiz.html  # 恋爱契合度测试 (compatibility quiz)
├── CLAUDE.md                # This file
└── .gitignore
```

## Architecture

### Worker (`_worker.js`)

Clean router → middleware → handler pattern.

```
Request → matchRoute(method, path) → handler(request, env, ctx) → Response
```

**Helpers:**
- `json(data, status)` — JSON response with CORS
- `err(message, status)` — error response
- `callMiniMax(system, messages, maxTokens, temp)` — MiniMax API call
- `bufferMiniMaxStream(resp)` — stream MiniMax and buffer result
- `stripThinkTags(text)` — remove `<think>` tags from MiniMax M2.5

**Middleware:**
- `handleCORS(request)` — OPTIONS preflight
- `requirePOST(request)` — enforce POST method
- `getUser(request, env)` — extract user from auth token (scaffold)
- `requireAuth(request, env)` — require authenticated user (scaffold)

**Routes:**
| Method | Path | Handler | Auth |
|--------|------|---------|------|
| POST | /api/chat | MiniMax buffered proxy | No |
| POST | /api/chat/stream | MiniMax SSE relay | No |
| POST | /api/image | MiniMax image generation | No |
| POST | /api/auth/register | Registration (scaffold) | No |
| POST | /api/auth/login | Login (scaffold) | No |
| GET | /api/auth/me | Get current user (scaffold) | Yes |
| * | /* | Static assets from public/ | No |

### Database (D1)

Tables: `users`, `sessions`, `results`

```sql
users:    id, email, name, password (hashed), created_at, updated_at
sessions: token, user_id, expires_at, created_at
results:  id, user_id, test_type, code, scores (JSON), created_at
```

### Frontend

Each page is a standalone React SPA (CDN React + Babel in-browser compilation).

**Design System:**
- Background: `#FAFAF7` (warm cream)
- Accent: `#C76D2E` (warm brown)
- Text: `#111` / `#777` (sub) / `#aaa` (muted)
- Cards: `rgba(255,255,255,0.92)` with `1px solid rgba(0,0,0,0.06)`
- Border radius: 14px (cards), 10px (buttons)
- Font: PingFang SC / Noto Sans SC

### MiniMax API

- **Endpoint:** `https://api.minimaxi.com/v1/chat/completions` (note the `i`)
- **Model:** `MiniMax-M2.5-highspeed`
- **Key:** In `_worker.js` as `MINIMAX_KEY`
- **Quirk:** M2.5 wraps reasoning in `<think>` tags — must strip them
- **Streaming:** Always use `stream: true`, buffer or relay via SSE

## Development

```bash
# Install wrangler
npm i -g wrangler

# Local dev
wrangler dev

# Deploy
wrangler deploy

# D1 setup (first time)
wrangler d1 create lovetype-db
# Copy database_id to wrangler.toml
wrangler d1 execute lovetype-db --file=schema.sql
```

## Adding New API Routes

1. Write handler function following the pattern:
```js
async function handleMyRoute(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;
  // ... your logic ...
  return json({ result: "ok" });
}
```

2. Register in routes table:
```js
const routes = {
  // ...existing routes...
  "POST /api/my-route": handleMyRoute,
};
```

## Adding Auth-Protected Routes

```js
async function handleProtected(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const authErr = await requireAuth(request, env); if (authErr) return authErr;
  const user = await getUser(request, env);
  // user.id, user.email available
  return json({ user });
}
```
