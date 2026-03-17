// Cloudflare Pages Advanced Mode — single worker entry point
// Handles /api/chat route + falls through to static assets for everything else

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

      // Keepalive every 8s to prevent intermediary timeouts
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
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta?.content || "";
              if (delta) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({delta})}\n\n`));
                lastSend = Date.now();
              }
              if (chunk.choices?.[0]?.finish_reason) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  done: true,
                  finish_reason: chunk.choices[0].finish_reason,
                  usage: chunk.usage || {}
                })}\n\n`));
                lastSend = Date.now();
              }
            } catch {}
          }
        }
        // Process remaining buffer
        if (buffer.trim().startsWith("data:")) {
          const data = buffer.trim().slice(5).trim();
          if (data !== "[DONE]") {
            try {
              const chunk = JSON.parse(data);
              if (chunk.choices?.[0]?.finish_reason) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  done: true,
                  finish_reason: chunk.choices[0].finish_reason,
                  usage: chunk.usage || {}
                })}\n\n`));
              }
            } catch {}
          }
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

    // Everything else — serve static assets
    return env.ASSETS.fetch(request);
  },
};
