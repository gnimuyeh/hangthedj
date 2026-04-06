// ═══════════════════════════════════════════════
// LoveType Worker — Cloudflare Workers
// ═══════════════════════════════════════════════
//
// Architecture:
//   Router → Middleware → Handler → Response
//
// Routes:
//   /api/auth/*     — auth endpoints (scaffold)
//   /api/chat       — MiniMax chat proxy (buffered)
//   /api/chat/stream — MiniMax chat proxy (SSE)
//   /api/image      — MiniMax image generation
//   /*              — static assets from public/
//
// Bindings (wrangler.toml):
//   env.DB          — D1 database
//   env.ASSETS      — static asset serving

// ── Config ──

const MINIMAX_KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const MINIMAX_CHAT_URL = "https://api.minimaxi.com/v1/chat/completions";
const MINIMAX_IMAGE_URL = "https://api.minimaxi.com/v1/image_generation";
const MINIMAX_MODEL = "MiniMax-M2.5-highspeed";

// ── Helpers ──

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

/** Strip MiniMax <think> tags from response text */
function stripThinkTags(text) {
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*/g, "").trim();
  return text;
}

/** Stream from MiniMax and buffer the full response */
async function bufferMiniMaxStream(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finishReason = "?";
  let usage = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        fullText += chunk.choices?.[0]?.delta?.content || "";
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.usage) usage = chunk.usage;
      } catch {}
    }
  }
  return { text: stripThinkTags(fullText), finish_reason: finishReason, usage };
}

/** Call MiniMax API with streaming enabled */
async function callMiniMax(system, messages, maxTokens, temperature = 0.85) {
  const msgs = [];
  if (system) msgs.push({ role: "system", content: system });
  for (const m of messages) msgs.push({ role: m.role, content: m.content });

  const payload = { model: MINIMAX_MODEL, messages: msgs, temperature, stream: true };
  if (maxTokens && maxTokens > 0) payload.max_tokens = maxTokens;

  return fetch(MINIMAX_CHAT_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + MINIMAX_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ── Middleware ──

/** CORS preflight handler */
function handleCORS(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

/** Require POST method */
function requirePOST(request) {
  if (request.method !== "POST") return err("POST only", 405);
  return null;
}

/** Device auth — find or create user by X-Device-Id header */
async function getUser(request, env) {
  const deviceId = request.headers.get("X-Device-Id");
  if (!deviceId) return null;

  let user = await env.DB.prepare("SELECT * FROM users WHERE device_id = ?").bind(deviceId).first();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, device_id) VALUES (?, ?)").bind(id, deviceId).run();
    user = { id, device_id: deviceId };
  }
  return user;
}

/** Require device ID */
function requireDevice(request) {
  if (!request.headers.get("X-Device-Id")) return err("X-Device-Id header required", 400);
  return null;
}

// ── Route Handlers ──

// POST /api/chat — buffered MiniMax response
async function handleChat(request) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;

  try {
    const { system, messages, max_tokens, temperature } = await request.json();
    const resp = await callMiniMax(system, messages, max_tokens, temperature);
    if (!resp.ok) {
      const errText = await resp.text();
      return err("MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200), 502);
    }
    const result = await bufferMiniMaxStream(resp);
    return json(result);
  } catch (e) {
    return err(e.message, 500);
  }
}

// POST /api/chat/stream — SSE relay from MiniMax
async function handleChatStream(request) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;

  try {
    const { system, messages, max_tokens, temperature } = await request.json();
    const resp = await callMiniMax(system, messages, max_tokens, temperature);
    if (!resp.ok) {
      const errText = await resp.text();
      return err("MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200), 502);
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const send = (data) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

    const process = async () => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastSend = Date.now();
      let sentDone = false;

      const keepalive = setInterval(async () => {
        if (Date.now() - lastSend > 8000) {
          try { await writer.write(encoder.encode(": keepalive\n\n")); } catch {}
        }
      }, 8000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              if (chunk.error || chunk.base_resp?.status_code) {
                await send({ error: chunk.error?.message || chunk.base_resp?.status_msg || "MiniMax stream error" });
                sentDone = true; break;
              }
              const delta = chunk.choices?.[0]?.delta?.content || "";
              const finishReason = chunk.choices?.[0]?.finish_reason || null;
              if (delta) { await send({ delta }); lastSend = Date.now(); }
              if (finishReason) {
                await send({ done: true, finish_reason: finishReason, usage: chunk.usage || {} });
                lastSend = Date.now(); sentDone = true;
              }
            } catch {}
          }
        }
        if (!sentDone) await send({ done: true, finish_reason: "eof", usage: {} });
      } finally {
        clearInterval(keepalive);
        try { await writer.close(); } catch {}
      }
    };

    process();
    return new Response(readable, {
      headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    return err(e.message, 500);
  }
}

// POST /api/image — MiniMax image generation
async function handleImage(request) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;

  try {
    const { prompt } = await request.json();
    if (!prompt) return err("prompt is required");

    const resp = await fetch(MINIMAX_IMAGE_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + MINIMAX_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "image-01", prompt, aspect_ratio: "16:9", response_format: "url", n: 1 }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return err("MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200), 502);
    }
    const result = await resp.json();
    const url = result?.data?.image_urls?.[0];
    if (!url) return err("No image URL in response", 502);
    return json({ url });
  } catch (e) {
    return err(e.message, 500);
  }
}

// ── User + Results Handlers ──

// GET /api/auth/me — return current user
async function handleMe(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);
  return json({ user });
}

// POST /api/results — save a test result
async function handleSaveResult(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);

  const { test_type, code, scores } = await request.json();
  if (!test_type || !scores) return err("test_type and scores required");

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO results (id, user_id, test_type, code, scores) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, user.id, test_type, code || null, JSON.stringify(scores)).run();
  return json({ id });
}

// GET /api/results — get user's test results
async function handleGetResults(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);

  const { results } = await env.DB.prepare(
    "SELECT id, test_type, code, scores, created_at FROM results WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(user.id).all();

  // Parse scores JSON for each result
  const parsed = results.map(r => ({ ...r, scores: JSON.parse(r.scores) }));
  return json({ results: parsed });
}

// ── Router ──

const routes = {
  "POST /api/chat":        (req, env) => handleChat(req),
  "POST /api/chat/stream": (req, env) => handleChatStream(req),
  "POST /api/image":       (req, env) => handleImage(req),
  "GET /api/auth/me":      handleMe,
  "POST /api/results":     handleSaveResult,
  "GET /api/results":      handleGetResults,
};

function matchRoute(method, pathname) {
  // Exact match
  const key = `${method} ${pathname}`;
  if (routes[key]) return routes[key];

  // OPTIONS for any /api/* route
  if (method === "OPTIONS" && pathname.startsWith("/api/")) {
    return () => new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return null;
}

// ── Entry Point ──

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = matchRoute(request.method, url.pathname);

    if (handler) return handler(request, env, ctx);

    // Static assets
    return env.ASSETS.fetch(request);
  },
};
