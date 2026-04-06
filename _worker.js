// Cloudflare Worker — API proxy + static asset serving
// Handles /api/chat, /api/chat/stream, /api/image routes + serves static files via Workers Static Assets

const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function handleChat(request) {
  const headers = { ...CORS, "Content-Type": "application/json" };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  try {
    const { system, messages, max_tokens, temperature: reqTemp } = await request.json();
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    for (const m of (messages || [])) msgs.push({ role: m.role, content: m.content });

    const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: reqTemp ?? 0.85, stream: true };
    if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }), { status: 502, headers });
    }

    // Stream from MiniMax, buffer everything, return single JSON response.
    // Streaming keeps the connection alive — no timeout issues on Cloudflare.
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
          const delta = chunk.choices?.[0]?.delta?.content || "";
          fullText += delta;
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage) usage = chunk.usage;
        } catch {
          // skip unparseable chunks
        }
      }
    }

    // Strip think tags
    fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (fullText.includes("<think>")) fullText = fullText.replace(/<think>[\s\S]*/g, "").trim();

    return new Response(JSON.stringify({ text: fullText, finish_reason: finishReason, usage }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// SSE streaming handler — relays MiniMax chunks to client in real time.
// Used for extraction calls where connection keepalive is critical.
async function handleChatStream(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    const { system, messages, max_tokens, temperature: reqTemp } = await request.json();
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    for (const m of (messages || [])) msgs.push({ role: m.role, content: m.content });

    const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: reqTemp ?? 0.85, stream: true };
    if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const process = async () => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastSend = Date.now();
      let sentDone = false;

      // Keepalive every 8s to prevent intermediary timeouts
      const keepalive = setInterval(async () => {
        if (Date.now() - lastSend > 8000) {
          try { await writer.write(encoder.encode(": keepalive\n\n")); } catch {}
        }
      }, 8000);

      function parseSSELine(data) {
        if (!data || data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data);
          // Detect MiniMax error responses in stream
          if (chunk.error || chunk.base_resp?.status_code) {
            const errMsg = chunk.error?.message || chunk.base_resp?.status_msg || "MiniMax stream error";
            return { error: errMsg };
          }
          const delta = chunk.choices?.[0]?.delta?.content || "";
          const finishReason = chunk.choices?.[0]?.finish_reason || null;
          return { delta, finishReason, usage: chunk.usage };
        } catch { return null; }
      }

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
            const parsed = parseSSELine(trimmed.slice(5).trim());
            if (!parsed) continue;

            if (parsed.error) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({error: parsed.error})}\n\n`));
              sentDone = true;
              break;
            }
            if (parsed.delta) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({delta: parsed.delta})}\n\n`));
              lastSend = Date.now();
            }
            if (parsed.finishReason) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({
                done: true, finish_reason: parsed.finishReason, usage: parsed.usage || {}
              })}\n\n`));
              lastSend = Date.now();
              sentDone = true;
            }
          }
        }
        // Process remaining buffer
        if (!sentDone && buffer.trim().startsWith("data:")) {
          const parsed = parseSSELine(buffer.trim().slice(5).trim());
          if (parsed?.finishReason) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({
              done: true, finish_reason: parsed.finishReason, usage: parsed.usage || {}
            })}\n\n`));
            sentDone = true;
          }
        }
        // Always send done so client never hangs
        if (!sentDone) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({done: true, finish_reason: "eof", usage: {}})}\n\n`));
        }
      } finally {
        clearInterval(keepalive);
        try { await writer.close(); } catch {}
      }
    };

    // Don't await — let it run in background while response streams
    process();

    return new Response(readable, {
      headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}

const IMAGE_URL = "https://api.minimaxi.com/v1/image_generation";

async function handleImage(request) {
  const headers = { ...CORS, "Content-Type": "application/json" };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  try {
    const { prompt } = await request.json();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), { status: 400, headers });
    }

    const resp = await fetch(IMAGE_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "image-01", prompt, aspect_ratio: "16:9", response_format: "url", n: 1 }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }), { status: 502, headers });
    }

    const result = await resp.json();
    const url = result?.data?.image_urls?.[0];
    if (!url) {
      return new Response(JSON.stringify({ error: "No image URL in response" }), { status: 502, headers });
    }

    return new Response(JSON.stringify({ url }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Route /api/chat/stream to SSE streaming handler (for extraction)
    if (url.pathname === "/api/chat/stream") {
      return handleChatStream(request);
    }

    // Route /api/chat to buffered handler (for chat)
    if (url.pathname === "/api/chat") {
      return handleChat(request);
    }

    // Route /api/image to image generation handler
    if (url.pathname === "/api/image") {
      return handleImage(request);
    }

    // Everything else — serve static assets
    return env.ASSETS.fetch(request);
  },
};
