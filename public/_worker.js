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

// Interview guide prompt for quiz creation chat
const QUIZ_INTERVIEW_SYS = `你是一个恋爱契合度测试设计专家。你的任务是通过5-8轮对话，了解用户在亲密关系中的偏好、价值观和生活方式，为他们定制一套个性化的默契测试。

# 对话策略

**第1轮：生活背景**
- 你做什么工作？生活节奏是怎样的？
- 你的生活中有什么不太常规的地方，伴侣需要接受？
- 你的硬性底线是什么（绝对不能接受的事）？

**第2轮：关系动态**
- 你希望关系中的分工是怎样的？（谁主导什么、决策方式、财务）
- 你需要多少个人空间和自由度？
- 你理想中和伴侣的工作日/周末是怎么过的？

**第3轮：价值观与性格**
- 你最看重伴侣的什么特质？
- 你怎么处理冲突？希望伴侣怎么处理？
- 你对健康、运动、饮食的态度？

**第4轮：深层偏好**
- 家庭/孩子的计划和期望？
- 对忠诚、边界、专一的看法？
- 你想避免过去关系中的什么模式？

**第5轮：校准**
- 用3句话描述你的理想伴侣
- 有什么大多数人想不到但对你很重要的？
- 有什么你想间接/隐晦地测试的？

# 风格
- 每条2-4句话，口语化，不要长段落
- 自然地追问，不要像填问卷
- 适当给出观察和反馈
- 覆盖足够维度后说："我已经了解够了，现在可以帮你生成测试了。点击生成按钮吧！"`;

// Quiz generation prompt — takes full transcript, outputs structured JSON
const QUIZ_GEN_SYSTEM = `你是一个专业的恋爱契合度测试生成器。根据用户的对话记录，生成一套完整的个性化默契测试。

# 核心原则

**反作弊设计是第一优先级。** 如果测试者能猜出哪个选项得分最高，这个测试就废了。

## 反作弊技巧
- 用取舍题而非美德题：不要问"你在乎健康吗"（所有人都说是），而是问"周五晚上你更想——去新开的网红餐厅/一起做顿健康餐/去健身房/叫外卖看电影？"
- 用场景两难题：每个选项都应该听起来合理
- 隐藏测试维度：一道关于"下雨天周日怎么过"的题可以同时测试自发性、家庭感、独立性
- 所有选项都要有吸引力：如果D选项明显最"成熟"，所有人都选D
- 用行为描述而非自我评价："你会怎么做"比"你觉得自己是什么样的人"好
- 避免价值导向词汇："成熟""健康""成长"这些词会暴露正确答案

## 维度设计（10-15个）

从对话中提取，每个维度需要：
- key: 英文短键名
- name: 中文显示名
- weight: 0.8-1.3（对此用户的重要程度）
- idealMin: -2到2（理想范围下限）
- idealMax: -2到2（理想范围上限）
- icon: emoji
- descHigh: 高分描述
- descMid: 中等描述
- descLow: 低分描述

## 问题设计（25-35题）

每题4个选项，分数范围-2到+2。

**分数不一定是递增的！** 可以是A=-2, B=+1, C=+2, D=0。有时候两个选项都可以是+2。

好的题目类型：场景两难、取舍选择、行为预测、生活快照、反应测试
坏的题目类型：自评量表、美德信号、引导性问题、抽象价值观

## 输出格式

只输出纯JSON，不要代码块，不要解释。直接以{开头。

{
  "title": "XX的默契测试",
  "description": "简短介绍（1-2句话）",
  "dimensions": [
    {"key":"dim_key","name":"中文名","weight":1.0,"idealMin":0.5,"idealMax":1.5,"icon":"emoji","descHigh":"高分描述","descMid":"中等描述","descLow":"低分描述"}
  ],
  "questions": [
    {"id":1,"d":"dim_key","t":"题目文字","o":[
      {"t":"选项A文字","s":-2},
      {"t":"选项B文字","s":0},
      {"t":"选项C文字","s":1},
      {"t":"选项D文字","s":2}
    ]}
  ],
  "config": {
    "tiers": [
      {"min":90,"label":"天作之合","desc":"你们简直是为彼此量身定做的"},
      {"min":75,"label":"心有灵犀","desc":"你们在很多关键维度上高度契合"},
      {"min":60,"label":"值得探索","desc":"有不少共同点，也有一些需要磨合的地方"},
      {"min":40,"label":"风格迥异","desc":"你们的差异不少，但差异也可以是互补"},
      {"min":0,"label":"次元不同","desc":"你们的生活方式和价值观差距较大"}
    ]
  }
}`;


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

// POST /api/auth/name — set user display name
async function handleSetName(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);
  const { name } = await request.json();
  if (!name?.trim()) return err("name required");
  await env.DB.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").bind(name.trim(), user.id).run();
  return json({ ok: true });
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

// ── Quiz Handlers ──

/** Generate short URL-friendly ID */
function shortId(len = 8) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join("");
}

// POST /api/quiz/generate — create quiz from interview transcript
async function handleQuizGenerate(request, env) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);

  const { transcript } = await request.json();
  if (!transcript) return err("transcript required");

  // Call MiniMax to generate quiz from interview
  const resp = await callMiniMax(QUIZ_GEN_SYSTEM, [{role: "user", content: transcript}], 8192, 0.5);
  if (!resp.ok) {
    const errText = await resp.text();
    return err("MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200), 502);
  }
  const result = await bufferMiniMaxStream(resp);
  let quiz;
  try {
    // Strip markdown code blocks if present
    let text = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    quiz = JSON.parse(text);
  } catch (e) {
    return err("Failed to parse quiz JSON: " + e.message + "\n\nRaw: " + result.text.substring(0, 500), 502);
  }

  if (!quiz.dimensions?.length || !quiz.questions?.length) {
    return err("Generated quiz missing dimensions or questions", 502);
  }

  const id = shortId();
  await env.DB.prepare(
    "INSERT INTO quizzes (id, creator_id, title, description, dimensions, questions, config) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    id, user.id,
    quiz.title || "默契测试",
    quiz.description || null,
    JSON.stringify(quiz.dimensions),
    JSON.stringify(quiz.questions),
    JSON.stringify(quiz.config || {})
  ).run();

  return json({ id, url: "/quiz/" + id });
}

// GET /api/quiz/:id — fetch quiz data for template
async function handleQuizGet(request, env, quizId) {
  const cors = handleCORS(request); if (cors) return cors;

  const quiz = await env.DB.prepare(
    "SELECT id, title, description, dimensions, questions, config, created_at FROM quizzes WHERE id = ?"
  ).bind(quizId).first();
  if (!quiz) return err("Quiz not found", 404);

  return json({
    ...quiz,
    dimensions: JSON.parse(quiz.dimensions),
    questions: JSON.parse(quiz.questions),
    config: quiz.config ? JSON.parse(quiz.config) : {},
  });
}

// POST /api/quiz/:id/submit — save taker's result (one per device per quiz)
async function handleQuizSubmit(request, env, quizId) {
  const cors = handleCORS(request); if (cors) return cors;
  const post = requirePOST(request); if (post) return post;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);

  // Check if already submitted
  const existing = await env.DB.prepare(
    "SELECT id, overall, scores, created_at FROM quiz_submissions WHERE quiz_id = ? AND user_id = ?"
  ).bind(quizId, user.id).first();
  if (existing) {
    return json({ existing: true, ...existing, scores: JSON.parse(existing.scores) });
  }

  const { overall, scores, name } = await request.json();
  if (overall == null || !scores) return err("overall and scores required");

  // Update user name if provided and not set
  if (name && !user.name) {
    await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO quiz_submissions (id, quiz_id, user_id, overall, scores) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, quizId, user.id, Math.round(overall), JSON.stringify(scores)).run();

  return json({ id, overall: Math.round(overall) });
}

// GET /api/quiz/:id/submissions — creator views all submissions
async function handleQuizSubmissions(request, env, quizId) {
  const cors = handleCORS(request); if (cors) return cors;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);

  // Verify creator
  const quiz = await env.DB.prepare("SELECT creator_id FROM quizzes WHERE id = ?").bind(quizId).first();
  if (!quiz) return err("Quiz not found", 404);
  if (quiz.creator_id !== user.id) return err("Not quiz creator", 403);

  const { results } = await env.DB.prepare(
    "SELECT s.id, s.overall, s.scores, s.created_at, u.name FROM quiz_submissions s LEFT JOIN users u ON s.user_id = u.id WHERE s.quiz_id = ? ORDER BY s.created_at DESC"
  ).bind(quizId).all();

  const parsed = results.map(r => ({ ...r, scores: JSON.parse(r.scores) }));
  return json({ submissions: parsed });
}

// GET /api/quiz/:id/my-result — check if current device already submitted
async function handleQuizMyResult(request, env, quizId) {
  const cors = handleCORS(request); if (cors) return cors;
  const dev = requireDevice(request); if (dev) return dev;
  const user = await getUser(request, env);

  const existing = await env.DB.prepare(
    "SELECT id, overall, scores, created_at FROM quiz_submissions WHERE quiz_id = ? AND user_id = ?"
  ).bind(quizId, user.id).first();

  if (!existing) return json({ submitted: false });
  return json({ submitted: true, ...existing, scores: JSON.parse(existing.scores) });
}

const routes = {
  "POST /api/chat":        (req, env) => handleChat(req),
  "POST /api/chat/stream": (req, env) => handleChatStream(req),
  "POST /api/image":       (req, env) => handleImage(req),
  "GET /api/auth/me":      handleMe,
  "POST /api/auth/name":   handleSetName,
  "POST /api/results":     handleSaveResult,
  "GET /api/results":      handleGetResults,
  "POST /api/quiz/generate": handleQuizGenerate,
};

function matchRoute(method, pathname) {
  // Exact match
  const key = `${method} ${pathname}`;
  if (routes[key]) return routes[key];

  // Parameterized quiz routes: /api/quiz/:id/*
  const quizMatch = pathname.match(/^\/api\/quiz\/([a-z0-9]+)(\/.*)?$/);
  if (quizMatch) {
    const quizId = quizMatch[1];
    const sub = quizMatch[2] || "";
    if (method === "GET" && sub === "") return (req, env) => handleQuizGet(req, env, quizId);
    if (method === "POST" && sub === "/submit") return (req, env) => handleQuizSubmit(req, env, quizId);
    if (method === "GET" && sub === "/submissions") return (req, env) => handleQuizSubmissions(req, env, quizId);
    if (method === "GET" && sub === "/my-result") return (req, env) => handleQuizMyResult(req, env, quizId);
  }

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

    // Serve quiz.html for /quiz/:id routes
    if (url.pathname.match(/^\/quiz\/[a-z0-9]+\/?$/)) {
      return env.ASSETS.fetch(new Request(new URL("/quiz.html", url.origin), request));
    }

    // Static assets
    return env.ASSETS.fetch(request);
  },
};
